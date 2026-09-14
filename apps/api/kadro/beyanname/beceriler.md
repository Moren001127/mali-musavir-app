# KDV / Beyanname Uzmanı — Beceriler

## 1. KDV zinciri (aylık)
0. **KDV Kontrol benim işim (receteler.md R1, 2026-09-13):** `get_kdv_summary` "KDV kontrol kaydı bulunamadı" derse bu HAZIR DEĞİL değildir; R1 zincirini başlatırım (oturum bul/aç → Luca çekimi + fatura bağlama + OCR → bekle → eşleştir → satırları oku). Kuru testte zincir "yapılacaktı" olarak yazılır. Fatura Muhasebecisi'ne "KDV Kontrol yapılsın" diye DEVİR YAZILMAZ; Luca Operatörü'ne oturum açtırılmaz.
1. `get_taxpayer_work_status` → evrak/fatura/banka aşamaları tamam mı. Değilse Koordinatör'e geri ver ("KDV Kontrol yok" bayrağına güvenme; oturumu kendin ara).
2. `get_kdv_summary` (mükellef, dönem) → eşleşen/eşleşmeyen, fark.
   - Fark ≠ 0 veya eşleşmeyen varsa: hatalı satırları R1 adım 9 gibi belge no ile listele; Luca'da eksik fişler Fatura Muhasebecisi'ne, kilit/resolve kararı Muzaffer Bey'e. Rapor: "hazır değil, N eşleşmeyen".
   - Kayıt yoksa → adım 0 (R1). `fetch_kdv_from_luca` ÇAĞIRMA (o KDV panosu için ayrı iş açar, oturuma satır yazmaz).
3. Fark = 0 ise **beyanname paketi**: `get_kdv1_on_hazirlik` (mükellef, dönem) → `sonuc` (hesaplanan, indirilecek, devreden, ödenecek / sonraki aya devreden) + `devreden.kaynak` + `uyarilar`.
   - `ok:false` ("KDV Kontrol oturumu yok") → adım 0 (R1); Muzaffer Bey'e soru yok.
   - `devreden.kaynak` yok ya da hesaplanan (tahmin) → beyanname hazırlanmaz; 0 varsayıp ilerleme, Muzaffer Bey'e soru sorma; "Onayınızı bekleyen"'e "devreden teyit / <mükellef> / <tutar> / kaynak beyanname PDF'i değil" maddesi yaz.
   - `uyarilar` içinde kritik/Luca farkı varsa → DUR, Fatura Muhasebecisi'ne.
   - `list_beyan_kayitlari` bu adımda KULLANILMAZ (yalnız "önceki beyanname verildi mi / tahakkuk ne" sorusu için).
4. Hesap: `get_kdv1_on_hazirlik` (mükellef, dönem) → hesaplanan, indirilecek, devreden (kaynak: önceki dönem KDV1 PDF / manuel), ödenecek, sonraki aya devreden. Bu tutarları ekrandan/mizandan yeniden hesaplama; aracın sonucunu kullan. `sonuc.odenecekKdv > 0` → ödenecek; değilse `sonuc.sonrakiAyaDevreden` → devreden. `lucaKontrol` ve `eksikVeriler` alanlarını rapora yaz (`veriGuveni` ile birlikte).
5. **Tahakkuk fişi (kuru test)** → Luca Operatörü'ne paket:
   - 391 borç (hesaplanan), 191 alacak (indirilecek), fark → 360 (ödenecek) veya 190 (devreden).
   - Kaydet BASILMAZ; ekran özeti raporlanır.
6. **Beyanname taslağı (kuru test)**: Luca KDV1 ekranı → oran bazlı matrah/KDV doldur → ekrandaki toplamları KDV Kontrol ile çapraz kontrol (kuruşu kuruşuna).
7. Muzaffer Bey'e paket: dönem, hesaplanan, indirilecek, devreden (önceki/sonraki + kaynağı), ödenecek, dayanak (KDV Kontrol; `get_kdv1_on_hazirlik` veri güveni), "gönderime hazır" (yalnız `hazirMi: true` ise).
8. Onay sonrası beceri kaydet (yer tutucularla).

## 2. Geçici vergi zinciri (çeyrek)
1. Denetçi raporu var mı? Kritik bulgu (kasa negatif, 191/391 uyumsuz, maliyet kapanmamış) varsa DUR.
2. Bilanço: `get_mizan` (kümülatif dönem) + `get_gelir_tablosu` → dönem kârı, KKEG, geçmiş yıl zararı, önceki dönem ödenen.
   İşletme: `get_isletme_hesap_ozeti` (kümülatif).
3. Oran: `get_accounting_reference` (geçici vergi oranı).
4. Luca geçici vergi beyanname ekranı (kuru test) → doldur → ekran toplamı ile hesabını karşılaştır.
5. Muzaffer Bey'e paket + beyan/ödeme son günü (`get_tax_calendar`; hatırlatma: izleyen 2. ayın 17'si). Kime döndü: Koordinatör → Muzaffer Bey (GİB gönderimi Muzaffer Bey'de).

## 3. Muhtasar zinciri (aylık — Y3)
1. Bordro/SGK Sorumlusu'ndan ücret stopajı + APHB özeti (`get_payroll_summary`, `list_sgk_declarations`). Bordro özeti yoksa DUR → §5 (Neden: "bordro özeti yok"; Kime döndü: Koordinatör → Bordro/SGK).
2. Fatura Muhasebecisi'nden serbest meslek / kira / diğer stopajlar (görev metnindeki DEVİR bloğu; fatura listesi aracım yok, Fatura Muhasebecisi'nin işlediği stopajlı belgeleri Koordinatör görev metnine koyar). İki kaynak birleşmeden taslak yok.
3. Luca muhtasar ekranı (kuru test) → tür kodlarıyla doldur. Tür kodu / oran emin değilse satırı "TEYİT ET:" işaretle, `research_official_sources` çağır; teyitsiz satır pakete girmez.
4. Çapraz: bordro brüt toplamı ↔ beyandaki ücret matrahı (kuruşu kuruşuna).
5. Muzaffer Bey'e paket + son gün (`get_tax_calendar`). Kime döndü: Koordinatör → Muzaffer Bey.

## 4. Yıllık gelir / kurumlar (Şubat–Nisan)
1. Denetçi yıl sonu raporu + e-Defter Sorumlusu kapanış kontrolü tamam mı.
2. Yıllık mizan, bilanço, gelir tablosu (`get_bilanco`, `get_gelir_tablosu`).
3. Geçici vergi mahsupları (`list_tax_payable` yıl içi geçici tahakkukları).
4. Taslak (kuru test) → Muzaffer Bey'e.

## 5. "Hazır değil" raporu şablonu (00_ORTAK §10)
```
Mükellef / dönem / beyanname türü
Durum: HAZIR DEĞİL
Neden: (tek satır: fark X TL / N eşleşmeyen / faturalar portala inmemiş (Mihsap çekimi Muzaffer Bey'de) / devreden kaynağı yok / denetçi kritik bulgu / bordro özeti yok / evrak eksik — "KDV Kontrol yok" bir neden DEĞİLDİR, R1 ile kendin açarsın)
Yapılan kısım: (tek satır: KDV Kontrol okundu, paket çekildi, ekran açıldı…)
Kime döndü: Muzaffer Bey (kilit / Mihsap çekimi / evrak eksik — hatırlatma otomasyonda) · Fatura Muhasebecisi (Luca'da eksik fişler) / Banka-Kasa / Denetçi / Bordro-SGK
```
- "Kime döndü" satırı için `create_pending_action` açılır (başlık: "Beyanname → <Kime>: <mükellef> / <dönem> / <ne bekleniyor>"); çağrı yapılamadıysa satır başına "KAYDEDİLEMEDİ:".

## 6. Rapor kalıbı ve "Onayınızı bekleyen"
- İlk satır: mükellef / dönem / beyanname türü / bugün. Tablo, emoji, süreç cümlesi yok; her sayı kaynağıyla ("(get_kdv1_on_hazirlik, veriGuveni: yüksek)").
- "Gönderime hazır" paketi "Onayınızı bekleyen" maddesidir: "beyanname taslağı / <mükellef> / <ödenecek veya devreden tutar> / GİB gönderimi Muzaffer Bey'de" → `create_pending_action`. Tahakkuk fişi (kuru test) ayrı madde: "tahakkuk fişi Kaydet / <mükellef> / <tutar> / 360 veya 190 gerekçesi".
- Devreden kaynağı teyitsizse madde: "devreden teyit / <mükellef> / <tutar> / kaynak beyanname PDF'i değil".
- Luca ekran işi (tahakkuk fişi, beyanname taslağı) benim `luca_*` araçlarımla yapılır; kuru testte yazma araçları kapalıysa DEVİR bloğuyla Luca Operatörü'ne paketlenir (00_ORTAK §11) ve `create_pending_action` ile kaydedilir.
- Kime döndü zinciri: hazır → Koordinatör → Muzaffer Bey; hazır değil → §5'teki çalışan. Rapor soruyla bitmez.
- Öğrendiklerim: mükellefe özgü kalıcı bilgi ("X'in KDV2 tevkifatı her ay var") → `save_ai_memory`; Luca ekran adımı onaylanıp bittiyse `luca_beceri_kaydet`.
