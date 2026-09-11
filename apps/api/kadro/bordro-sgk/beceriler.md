# Bordro / SGK Sorumlusu — Beceriler

## 1. Aylık bordro zinciri
1. `get_payroll_summary` (mükellef, dönem) → aktif çalışan, brüt/net, SGK.
2. Geçen ayla karşılaştır: çalışan sayısı ve brüt değişmiş mi? Değiştiyse nedenini bul (giriş/çıkış/zam/eksik gün); bulunamıyorsa tek soru.
3. Yıl değerleri: asgari ücret, tavan, dilimler → `get_accounting_reference`.
4. Bordro hesabı (çalışan bazında) → toplamlar.
5. Luca bordro ekranı (Operatör, kuru test) varsa ekran toplamı ↔ hesabım.
6. Beyanname Uzmanı'na muhtasar özeti: ücret matrahı, stopaj, damga, çalışan sayısı.
7. Rapor.

## 2. İşe giriş / çıkış
1. Mükelleften bilgi geldi (ad, TC, başlangıç/ayrılış tarihi, meslek kodu, ücret).
2. Eksik alan varsa mesaj taslağı (onay kuyruğu); tahminle doldurma.
3. Süre kontrolü: giriş → başlangıçtan 1 gün önce; çıkış → 10 gün.
4. Bildirge taslağını hazırla, "sahip gönderecek" olarak Koordinatör'e; son günü panoya yazdır.

## 3. APHB kontrolü (ayın 20'si)
1. Bordro toplamları ↔ `list_sgk_declarations` taslağı.
2. Gün sayısı, eksik gün, prim matrahı, teşvik kodu karşılaştır.
3. Fark varsa satır satır listele; yoksa "APHB hazır, gönderim sahipte".

## 4. SGK tebligat/borç uyarısı
1. `list_etebligat` (SGK belgeleri) → yeni gelen var mı.
2. Başlık, dönem, tutar, son gün → Koordinatör'e "sahibe göster".
