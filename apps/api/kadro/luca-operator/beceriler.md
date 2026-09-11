# Luca Operatörü — Beceriler

## 1. Gelen iş paketini uygulama (genel kalıp)
1. Paketi oku: firma, dönem, ekran, alanlar/değerler, kuru test mi canlı mı.
2. `luca_beceri_listele` → aynı iş kayıtlı mı? Varsa `luca_beceri_getir` ile adımları al.
3. `luca_ekran_oku` → açık firma/dönem doğru mu; değilse firma/dönem değiştir (menüden), tekrar oku.
4. `luca_menu_ara` → `luca_menu_git` ile ekranı aç.
5. Her alan: `luca_yaz` / `luca_sec` → dönen ekranla doğrula (özellikle tarih).
6. Kuru test: DUR. Ekran özeti + "yapacaktım" raporu.
7. Canlı + onay: `luca_tikla` (`confirmed=true`) → sonucu oku → rapor.
8. İş onaylanıp bittiyse `luca_beceri_kaydet` (yer tutucularla) → tek cümle bildir.

## 2. Rapor okuma (Fiş Listesi / Mizan / Bilanço)
1. Menüden rapor ekranı → dönem aralığını yaz → ekrandan geri oku (mizan kümülatif, fiş listesi çeyrek).
2. "Listele/Raporla" tıkla (bu düğme veri değiştirmez, onay gerekmez).
3. `luca_ekran_oku` → "pencereler" alanı; boşsa bekle, tekrar oku.
4. Excel indiyse `luca_rapor_oku`.
5. Satırları iş veren çalışana veri olarak döndür; portala YAZMA.

## 3. Bilinmeyen ekranı öğrenme
1. Beceri yok → menüde ara → ekranı aç → alan etiketlerini, zorunlu alanları, açılır listeleri oku.
2. Aynı ekranda ÖNCEKİ DÖNEM kaydını listeden aç; nasıl doldurulmuş oku (hesap, kod, seçenek).
3. Yeni dönemi ona benzeterek doldur (kuru test).
4. Hâlâ boş kalan tek alan varsa TEK soru sor.

## 4. Kural kaydetme
- Sahip: "ödenecek çıkarsa 360, çıkmazsa 190" → `luca_kural_kaydet({baslik:"KDV tahakkuk 360/190", kural:"..."})` → "Şunu kaydettim: ..." diye geri oku.
- Değişiklik: `luca_kural_listele` ile tam başlığı bul, aynı başlıkla kaydet. Kaldırma: `luca_kural_sil`.

## 5. Menü haritası çıkarma (ilk kurulum / yeni firma türü)
1. `luca_menu_haritasi_cikar` (yalnız okur, dakikalar sürer).
2. Bittiğinde `luca_menu_ara` ile birkaç bilinen ekranı sına ("muhtasar", "fiş listesi", "mizan").
3. Rapor: kaç menü, hangi kök (Muhasebe / İşletme Defteri).
