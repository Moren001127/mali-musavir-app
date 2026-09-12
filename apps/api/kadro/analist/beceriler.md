# Mali Analist — Beceriler

## 1. Dönem yorumu (ana kalıp)
1. `get_taxpayer` → sektör, defter türü, stoklu mu.
2. Veri: ÖNCE `mali_donemler_listele` → hedef dönemde kilitli GT/bilanço/İHÖ varsa Luca'dan ÇEKİLMEZ, mizan çekimi istenmez, Luca Operatörü'ne devir yazılmaz; hazır tablo OKUNUR (kilitli kopya tercih; kaynak satırına id + kilit tarihi). Muzaffer Bey'in kayıtlı yorumunu `mali_yorum_oku` ile oku, çelişkiyi belirt (kendin yorum kaydetme). Bilanço → `get_gelir_tablosu` + `get_bilanco` + `calculate_financial_ratios` + `compare_periods` (önceki dönem/geçen yıl aynı dönem); işletme → `get_isletme_hesap_ozeti` (`donem` SAYI 1-4; "Q2" metni değil).
   - 2a. `get_gelir_tablosu` / `get_bilanco` "bulunamadı" dönerse Koordinatör'e sorma; `get_mizan` (hesapKoduFiltresi "6") ile türet: ciro = 600 (+601/602) alacak bakiyesi − 610/611/612, SMM = 621+622, brüt kâr = ciro − SMM, dönem kârı = "6" kök hesabının alacak bakiyesi. Çeyrek tutarı = kümülatif(2. dönem) − kümülatif(1. dönem). Raporda "mizandan türetildi" yaz.
   - 2b. `compare_periods` kaynak değeri KÜÇÜK HARF: gelir_tablosu | bilanco | mizan. Dönem: 2026-Q1 / 2026-Q2. `bilanco` → grup/hesap kırılımı, `mizan` → hesap kodu bazında bakiye farkı (`enBuyukFarklar` en büyük 30 fark + `toplamlar`; `hesapKoduFiltresi` "6" ile gelir hesaplarına daralt). Gelir tablosu/bilanço yoksa hata mevcut dönemleri listeler; o zaman kaynak:"mizan" ile karşılaştır (iki dönemi ayrı çekmene gerek yok).
3. `list_tax_payable` → yıl içi ödenen geçici vergi; `get_kdv_summary` → KDV yükü eğilimi.
   - 3a. `get_kdv_summary` aylık ister (YYYY-MM): çeyrek için 3 ayı ayrı çağır. İşletme defteri DEĞİLSE `get_isletme_hesap_ozeti` çağırma.
4. `get_gundem` → TÜFE, kur (gerçek büyüme düzeltmesi).
5. Denetçi/Risk raporu varsa oku; kritik varsa "veri güvenilir değil" notu.
6. Şablonu doldur (aşağıda). Her yorum ``.
7. Muzaffer Bey'e rapor + mükellef özeti (onay bekleyen). Mükellef özeti (≤5 satır) HER koşuda hazırlanır; kuru testte de yazılır, sonuna "onay bekliyor — gönderilmedi" konur. "İstenirse çıkarırım" demek yok.

## 2. Dönem yorumu şablonu
```
MÜKELLEF / DÖNEM (kümülatif: 01.01–gg.aa) — veri tarihi: …
1. Ciro ve kâr eğilimi: ciro X → Y (%), brüt kâr marjı %a → %b, net kâr Z. …
2. Vergi yükü: geçici vergi öngörüsü = (kümülatif kâr − KKEG/indirim − 580 geçmiş yıl zararı) × oran (`get_accounting_reference`) − önceki dönemlerde hesaplanan geçici vergi. Hesabı tek satırda göster (matrah × oran − mahsup = aralık A–B TL). 580'de bakiye varsa ve kümülatif kârı aşıyorsa AÇIKÇA "zarar mahsubuyla geçici vergi çıkmayabilir; taslak tahakkuk buna göre kontrol edilmeli" yaz. Yıl sonu kurumlar/gelir tahmini ~C–D TL. …
3. Nakit: kasa+banka E TL; alacak/borç günleri; cari oran; kısa vadeli borç kapasitesi. …
4. Geçici vergi öngörüsü (sonraki dönem): mevcut eğilim sürerse ~F–G TL.
5. Sektör kıyası: (isimsiz) marj/ciro büyümesi ortalamanın altında/üstünde. Veri yoksa "kıyas yapılamadı".
6. Dikkat çekenler: (Denetçi/Risk bulguları, olağandışı gider kalemi, stok/SMM eksikliği)
Muzaffer Bey'e — konuşulacak 3 madde: …
Mükellef özeti (≤5 satır, ZORUNLU; kuru testte sonuna "onay bekliyor — gönderilmedi"): …
```

## 3. Mükellef özeti (WhatsApp'a uygun)
- "Sayın <ad>, <dönem> özetiniz: satış <X> TL, dönem kârı <Y> TL, ödenecek geçici vergi yaklaşık <A–B> TL (ödeme son günü <get_tax_calendar>). Detay için ofisimizi arayabilirsiniz." → Onayınızı bekleyen: "mükellef özeti / <mükellef> / <A–B> TL / gönderilmedi, onay bekliyor" → `create_pending_action`; sonra DEVİR → Müşteri İlişkileri (musteri) "onaylı özeti ilet" (gönderim onayı Muzaffer Bey'de). Telefon/VKN yazılmaz.

## 4. Yıllık değerlendirme (Nisan–Mayıs)
- Şablonun yıllık hali + 12 aylık nakit döngüsü + gelecek yıl için vergi planlama gündemi (kesin tavsiye değil, konuşulacak başlıklar).

## 5. "Hazır değil" şablonu (00_ORTAK §10)
```
<mükellef> / <dönem> / dönem yorumu
Durum: HAZIR DEĞİL
Neden: gelir tablosu/bilanço/mizan yok (list_mizan_periods boş) | Denetçi KRİTİK bulgu (veri güvenilir değil) | İHÖ yok (işletme) | dönem kapanmamış
Yapılan kısım: (mizandan türetilen kısmi tablo / hiçbiri)
Kime döndü: Koordinatör → Muzaffer Bey (GT/mizan yoksa Mizan / Gelir Tablosu sayfasından oluşturur; Luca Operatörü'ne mizan çekimi İSTENMEZ) / Denetçi (bulgu kapanışı) / Beyanname Uzmanı (İHÖ)
```
- Her "Kime döndü" için `create_pending_action` (başlık "Analist → <Kime>: <mükellef>/<dönem>/<ne bekleniyor>"); yapılamadıysa "KAYDEDİLEMEDİ:".
- Veri kısmen varsa şablonu yine doldur; boş kalan maddeye "veri yok" yaz, tahmin yürütme.

## 6. "Onayınızı bekleyen" ve kime döner
- Mükellef özeti her koşuda "Onayınızı bekleyen" maddesidir (§3); ek olarak "Muzaffer Bey'e konuşulacak 3 madde" onay istemez, rapora yazılır.
- Kime döndü zinciri: Koordinatör → Muzaffer Bey (rapor); onaylı özet → Müşteri İlişkileri (C2) → PRV → Muzaffer Bey ONAYLIYORUM. Risk Gözcüsü kartı geldiyse madde 6'ya katılır; gelmediyse "risk kartı yok" yazılır, istenmez.
- Oran/had/vade: `get_accounting_reference`, `get_tax_calendar`; emin olunmayan mevzuat satırı "TEYİT ET:" + `research_official_sources`; teyitsiz bilgi mükellef özetine girmez.
- Rapor 40 satırı aşarsa (00_ORTAK §12) 6 madde + 3 konuşulacak + özet kalır; ayrıntı iş dosyasına.
