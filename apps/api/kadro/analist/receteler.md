# Mali Analist — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Dönem biçimi: mizan/GT 'YYYY-Qn' | 'YYYY-YILLIK' · İHÖ donem SAYI (1-4) · KDV 'YYYY-MM'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R2 — Gelir tablosu analizi / yorumu
KURAL: Portalda HAZIR (kilitli) tablo okunur. Luca'ya gidilmez, mizan çekimi İSTENMEZ, Luca Operatörü'ne devir YAZILMAZ. Tablo yoksa Muzaffer Bey Mizan/Gelir Tablosu sayfasından oluşturur.
Tetik: "Öz Ela Turizm'in 2026 2. dönem gelir tablosunu analiz et", "X'in 2. dönem gelir tablosunu yorumla", "X'in geçici vergi dönemi kârı nasıl".
1) Mükellef + dönem: "2. dönem / 2. dönem / Haziran sonu" → '2026-Q2'; yıllık → '2026-YILLIK'; defterTuru ISLETME → İHÖ yolu — list_taxpayers → get_taxpayer — oku — senkron — id + dönem + defterTuru — belirsiz → tek satır soru, DUR.
2) Hazır dönemleri listele (kilitli mi, kaynak, id; EDEFTER mizanları süzülmüş) — mali_donemler_listele {taxpayerId} — oku — senkron — hedef dönemde GT var mı, kilitli mi, id — GT yok → adım 4.
3) Hazır GT'yi oku; çift kayıtta KİLİTLİ olan tercih; manuel SMM 621 ÜSTÜNE eklenir — get_gelir_tablosu — oku — senkron — kalemler + "kaynak: portal GT <id> (kilitli <tarih>, kopya <n>)" — donemKari ≠ donemNetKari → "portal türev alanı güncel değil" de, rakamı düzeltme.
4) GT yoksa mizan '6' hesaplarından türet ("mizandan türetildi"); mizan da yoksa DUR — get_mizan {hesapKoduFiltresi:'6'} — oku — senkron — türetilmiş özet — mizan yok → "HAZIR DEĞİL: Muzaffer Bey Mizan/Gelir Tablosu sayfasından oluşturmalı" (Luca çekimi İSTEME).
5) Muzaffer Bey'in kayıtlı Mali Yorum'unu oku; çelişkiyi belirt; ajan yorum ÜRETMEZ/kaydetmez — mali_yorum_oku {kaynak:'GELIR_TABLOSU', kaynakId} — oku — senkron — {ozet, model, updatedAt} | null — null → "kayıtlı yorum yok".
6) Kıyas + rasyolar + ödenen geçici vergi — compare_periods → calculate_financial_ratios → list_tax_payable — oku — senkron — fark % tablosu — önceki dönem yok → tek dönem yorumu.
7) 6 madde yorum + Muzaffer Bey'e 3 konuşma maddesi + ≤5 satır mükellef özeti (GÖNDERİLMEZ) — create_pending_action — portal_yaz — — — rapor + onay kaydı — "KAYDEDİLEMEDİ:".
İHÖ dalı (ISLETME): get_isletme_hesap_ozeti {taxpayerId, yil, donem: 2} — donem SAYI; 'Q2' metni verme.
Rapor:
```
GELİR TABLOSU YORUMU — <Mükellef> <2026 2. dönem (Nisan–Haziran; kümülatif Ocak–Haziran)>
Kaynak: GT <id> (kilitli <tarih>, kopya <n>) | mizan <id> | manuel SMM
Özet: net satış · brüt kâr (%) · faaliyet kârı · net kâr · geçici vergi
Kıyas: <önceki dönem fark %>
Dikkat çekenler: (6 madde, her biri)
Kayıtlı AI yorumu: var|yok — uyuşmazlık: <varsa>
Muzaffer Bey'le 3 madde: …
MÜKELLEF ÖZETİ (onay bekliyor — gönderilmedi): ≤5 satır
Kuru testte gerçek yapılan işler: <liste | yok>
Kime döndü: Muzaffer Bey
```
