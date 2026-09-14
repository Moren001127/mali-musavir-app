# Beyanname Uzmanı — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım rapora "yapılacaktı"; onun çıktısına bağlı sonraki adımlar ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Kilitleme/kilit açma, resolve, GİB gönderimi, Mihsap çekimi her zaman Muzaffer Bey. Dönem biçimi: KDV Kontrol 'YYYY/MM' · Fatura Merkezi 'YYYY-MM' · mizan/GT 'YYYY-Qn' | 'YYYY-YILLIK'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R1 — KDV Kontrol zinciri (aylık) — PORTAL işi; Luca Operatörü'ne DEVRETME
Tetik: "X'in Ağustos KDV kontrolünü yap", "alış-satış mutabakatı", "KDV'sini Luca ile karşılaştır".
Dal: BILANCO → KDV_191+KDV_391; ISLETME → ISLETME_GIDER+ISLETME_GELIR (çekim türü oturumdan türer). Adım 3-4-5 paralel.
1) Mükellef + defterTuru + dönem 'YYYY/MM' — list_taxpayers → get_taxpayer — oku — senkron — tek id — çoklu eşleşme / defterTuru boş → DUR.
2) İki oturumu bul/aç; COMPLETED varsa "kilitli, açayım mı" sor — kdv_kontrol_oturum_bul_olustur — portal_yaz_agir — senkron — 2×{sessionId,type,status} — "Mükellef bulunamadı" → DUR.
3) Luca ajanı çevrimiçi mi; oturum başına çekim — get_agent_status → kdv_kontrol_luca_cek — luca_yaz — asenkron jobId — 2 jobId (mevcutIs olabilir) — çevrimdışı → DUR; kuru test → "yapılacaktı", adım 6/8/9 ÇAĞRILMAZ.
4) Mihsap faturalarını bağla — kdv_kontrol_fatura_bagla — portal_yaz_agir — senkron — linked+alreadyLinked>0 — "faturası yok" → "HAZIR DEĞİL: faturalar portala inmemiş (Mihsap çekimi Muzaffer Bey'de)".
5) OCR başlat (forceFresh YOK) — kdv_kontrol_ocr_baslat — portal_yaz_agir — asenkron — {queued,total,cacheHits} — FAILED'i say.
6) Luca işini bekle — luca_is_bekle {jobId,maxSaniye:60} — oku — ≤10 çağrı — done, recordCount>0 — failed → hata satırı, tekrar YOK; retryCount>0 → "teknik kilit, otomatik tekrar"; captcha → "güvenlik kodu bekliyor".
7) OCR'ı bekle — kdv_kontrol_ocr_bekle {sessionId,maxSaniye:60} — oku — ≤15 çağrı — bitti:true — aşıldı → "OCR sürüyor" DUR.
8) Eşleştir (kapı: Luca>0, görsel>0, OCR bitti) — kdv_kontrol_eslestir — portal_yaz_agir — senkron — sayaçlar; otoKilit:true → raporda "sorunsuz; oturum portaldaki gibi kilitlendi, fiş Word raporu oluşturuldu (yazdırma sizde), aylık takip işaretlendi, Luca KDV çekimi başladı" (Muzaffer Bey'in kararı 2026-09-13: ajanın işi kendi işi gibidir, kilit için ayrıca sorulmaz)
9) Satırları oku, sınıfla; karar VERME — kdv_kontrol_sonuc_satirlari {yalnizSorunlu:true,limit:100} — oku — — — tam=MATCHED/CONFIRMED · incele=PARTIAL/NEEDS_REVIEW/fark>%1 · "Luca'da var, fatura yok"=UNMATCHED+görsel yok · "Fatura var, Luca'da yok"=UNMATCHED+Luca yok · red=MISMATCH/REJECTED — boş → adım 8 bir kez tekrar.
10) Onay kaydı YALNIZ hatalı satır varsa: "N hatalı satır; düzeltilsin mi" (0 hatalıysa onay kaydı AÇMA; kilitlenme ve otomasyonlar raporda bildirilir) — create_pending_action — portal_yaz — — — id — "KAYDEDİLEMEDİ:".
Kuru test: adım 1 + 2'nin "bul" kısmı çalışır; gerisi "yapılacaktı"; rapor "HAZIR DEĞİL (kuru test): zincir kurulu, canlı için 'canlı yap' de".
Rapor:
```
KDV KONTROL — <Mükellef> <YYYY/MM> (<İşletme|Bilanço>) — <KURU TEST|CANLI>
Oturumlar: <GIDER/191 id, durum> · <GELIR/391 id, durum>
Luca: <n> satır (iş <jobId>, <süre>, mevcutIs?) | Fatura: <m> bağlı, OCR ok <>/teyit bekler <>/hata <>
SONUÇ: tam <> ✓ · incele <> ⚠ · hatalı <> ✗ (fatura yok: a · Luca'da yok: b · red: c)
HATALI SATIRLAR: - <belge no> <tarih> KDV <tutar> — <sebep>
İNCELE: - <belge no> — <mismatchReasons>
Kuru testte gerçek yapılan işler: <liste | yok>
DURUM: <KİLİTLENDİ (sorunsuz) | REVIEWING (hatalı satır var)> | Onayınızı bekleyen: <varsa madde, yoksa yok>
Kime döndü: Muzaffer Bey · Fatura Muhasebecisi (Luca'da eksik fişler)
```

## R3 — KDV1 beyanname ön hazırlığı + tahakkuk fişi taslağı
Tetik: "KDV beyannamesini hazırla", "ödenecek çıkar mı", "KDV1 rakamları".
1) İki oturum var mı, COMPLETED mi; yoksa R1'i çalıştır (durma) — get_kdv_summary — oku — — — oturum durumu — hatalı satır varsa paket "ön koşul: X satır çözülmeli" notuyla.
2) KDV1 paketi (hesaplanan/indirilecek/devreden/ödenecek + veri güveni) — get_kdv1_on_hazirlik — oku — — — sonuc + veriGuveni — ok:false → adım 1.
3) Devreden KDV kaynağı önceki KDV1 PDF mi — list_beyan_kayitlari — oku — — — kaynak belli — "hesaplanan" ise "Onayınızı bekleyen"'e "devreden teyit" maddesi.
4) Luca mizan çaprazı gerekiyorsa iş aç (KDV Kontrol oturumuna satır YAZMAZ) — fetch_kdv_from_luca → luca_is_bekle — luca_yaz — asenkron — done — failed → paket Luca çaprazı olmadan; kuru test → "yapılacaktı".
5) Tahakkuk fişi taslağı: 391 B / 191 A; fark 360 (ödeme çıkarsa) ya da 190 (çıkmazsa); Kaydet BASMA — luca_menu_git → luca_yaz → luca_ekran_oku — luca_yaz — senkron — ekran özeti — Luca kapalı → "fiş elle".
6) Son gün + onay kaydı — get_tax_calendar → create_pending_action — portal_yaz — — — pending id — "KAYDEDİLEMEDİ:". "Beyanname hazır" kutusu (set_monthly_status): kuru testte ve Muzaffer Bey açıkça istemeden İŞARETLEME; paket temizse raporda "işaretlenmeye hazır" diye öner.
Muzaffer Bey: fiş Kaydet (luca_tikla confirmed=true), GİB gönderimi, devreden teyidi.
Rapor: KDV1 PAKETİ — <Mükellef> <YYYY-MM> / hesaplanan · indirilecek · devreden (kaynak) · ödenecek|sonraki aya devreden / veri güveni / Luca çaprazı (var|yok|yapılacaktı) / Tahakkuk fişi taslağı (kuru test) / Gönderime hazır: EVET|HAYIR (neden) / "Onayınızı bekleyen" / Kime döndü: Muzaffer Bey.

## R7 — Geçici vergi paketi (çeyrek) — öncesi R6 (Denetçi), sonrası R2 (Analist)
Tetik: "geçici vergi paketi/beyannamesi".
1) Denetçi raporu var mı — search_ai_memory (ekip, mükellef, dönem) — oku — — — rapor özeti — KRİTİK bulgu → DUR; rapor yoksa Koordinatör'e "önce R6" (create_pending_action).
2) Bilanço: get_gelir_tablosu (kilitli, geciciVergiHesabi); İşletme: get_isletme_hesap_ozeti (donem SAYI 1-4) — oku — — — dönem kârı + KKEG + geçmiş yıl zararı — tablo yok → "HAZIR DEĞİL: Muzaffer Bey Mizan/Gelir Tablosu sayfasından oluşturmalı" (ajan üretmez).
3) Oran ve önceki ödenen — get_accounting_reference → list_tax_payable — oku — — — hesaplanan − önceki ödenen = ödenecek (tek satır) — referans yok → "TEYİT ET:".
4) Luca geçici vergi ekranı taslağı (kuru) → son gün → onay kaydı — luca_menu_git/luca_yaz → get_tax_calendar → create_pending_action — luca_yaz/portal_yaz — — — paket + pending id — GGECICI/KGECICI "verildi" işaretini ajan KOYMAZ.
Rapor: GEÇİCİ VERGİ — <Mükellef> <YYYY-Qn> / Denetçi: temiz|bulgu / matrah × oran − mahsup = ödenecek / kaynak GT <id> (kilitli) | İHÖ / son gün / "Onayınızı bekleyen" / Kime döndü: Muzaffer Bey (GİB gönderimi).
