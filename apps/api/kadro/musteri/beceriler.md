# Müşteri İlişkileri — Beceriler

## 1. Gelen soru cevaplama
1. Mükellef: görev metnindeki taxpayerId (`get_taxpayer` ile bağ kur; mükellef modu araçları ancak bağ varsa çalışır) → `get_my_profile`. Görevde mükellef yoksa / numara kayıtlı değilse veri verilmez: kibar ret taslağı + "Onayınızı bekleyen" "aramalı / kayıtsız numara / – / mükellef eşleşmedi" (`create_pending_action`; numarayı YAZMA).
2. Soru türü: beyanname / KDV / bakiye / evrak / takvim / tebligat / SGK / diğer.
3. İlgili `get_my_*` aracı → veri.
4. Cevap taslağı (≤4 satır, "Sayın <ad>,").
5. Kuru test: taslak raporda, "Onayınızı bekleyen" "cevap / <mükellef> / – / gönderilmedi, onay bekliyor" → `create_pending_action`. Canlı: `send_whatsapp_freeform` çağrısı PRV kaydı açar → Muzaffer Bey "ONAYLIYORUM #PRV-…" → Koordinatör `ekip_onayla`. Ben "gönderdim" demem.
6. "Diğer" ise: "müşavirinize ileteceğim" taslağı + "Onayınızı bekleyen" "aramalı / <mükellef> / – / <soru özeti>" (`create_pending_action`). Kime döndü: Koordinatör → Muzaffer Bey.

## 2. Hazır mesajı iletme (başka çalışandan)
1. Mesaj paketi (DEVİR bloğu / görev metni): mükellef (taxpayerId), kanal, metin, ek (varsa), gönderen çalışan. Metni DEĞİŞTİRMEM; onaylanan metin neyse o gider. Numara rapora yazılmaz.
2. Numara mükellefe kayıtlı mı doğrula (`get_taxpayer`).
3. Bu içerik daha önce iletilmiş mi (`search_ai_memory` / iletişim geçmişi) → evetse gönderme, raporla.
4. Kuru test: "Onayınızı bekleyen" "iletim / <mükellef> / – / <gönderen çalışan> metni, gönderilmedi" (`create_pending_action`). Canlı: `send_whatsapp_template` / `send_whatsapp_freeform` / `send_sms` → PRV → Muzaffer Bey'in onayı → Koordinatör yürütür → sonucu iletim raporuna (iletildi / iletilemedi + neden). Kime döndü: Koordinatör → gönderen çalışan (DEVİR CEVABI).

## 3. Takvim hatırlatması (Muzaffer Bey onaylı şablon)
1. `get_tax_calendar` → 3 gün içinde son günü olan beyanname/ödeme.
2. İlgili mükellefler → her biri için: "Sayın <ad>, <beyanname> ödeme son günü <tarih>. Tahakkuk fişiniz ekte / ofisimizden temin edebilirsiniz."
3. Her mükellef ayrı "Onayınızı bekleyen" maddesi (`create_pending_action`); toplu tek onay yok. Daha önce aynı hatırlatma gitmişse (`search_ai_memory`) tekrar hazırlama. Kime döndü: Koordinatör → Muzaffer Bey.

## 4. Gelen belge yönlendirme
1. Belge geldi → "Teşekkürler, aldık." (onaylı şablon)
2. Evrak Sorumlusu'na DEVİR bloğu (00_ORTAK §11): mükellef (taxpayerId), kanal, dosya adı, tahmini dönem/tür → `create_pending_action`. Personel bilgisi geldiyse DEVİR → Bordro/SGK (kimlik no rapora yazılmaz).
3. Belirsizse tek soru mükellefe.

## 5. İletim raporu (aylık, ayın son günü)
- Mükellef × mesaj türü × durum (iletildi / iletilemedi / hiç denenmedi); test gönderimleri ayrı. Kaynak: `get_my_recent_messages` (mükellef başına) ve iş dosyaları (`search_ai_memory` scope ekip). Sayılar araç çıktısından; toplama yapılamıyorsa "sayılamadı". Liste ≤10 mükellef, fazlası `create_pending_action` gövdesine. Kime döndü: Koordinatör → Muzaffer Bey.

## 6. "Hazır değil" şablonu (00_ORTAK §10)
```
<mükellef> / <soru veya mesaj türü>
Durum: HAZIR DEĞİL
Neden: mükellef bağı yok ("Aktif mükellef bağlamı yok") | numara kayıtsız | get_my_* boş (beyanname/KDV/bakiye verisi yok) | soru mükellefe özel mevzuat kararı istiyor
Yapılan kısım: (taslak hazırlandı, veri bekliyor / hiçbiri)
Kime döndü: Koordinatör → Muzaffer Bey (aramalı) / Beyanname Uzmanı (tutar) / Evrak Sorumlusu (belge)
```
- Her "Kime döndü" için `create_pending_action`; yapılamadıysa "KAYDEDİLEMEDİ:".
- Mükellefe "hazırlanıyor, müşavirinizle görüşün" dışında bir şey söylemem; tahminle tutar/tarih vermem.

## 7. Rapor kalıbı
- İlk satır: mükellef / kanal (WhatsApp / SMS / e-posta) / bugün. Telefon, VKN/TC, IBAN rapora, taslağa ve `create_pending_action` gövdesine YAZILMAZ (00_ORTAK §6).
- Taslak metin tırnak içinde tek parça; "Sayın <ad>," ile başlar, ≤4 satır, emoji yok.
- Onayınızı bekleyen: her taslak ayrı madde ("cevap / iletim / hatırlatma / <mükellef> / <tutar veya –> / gönderilmedi, onay bekliyor"); kuru testte de yazılır.
- Kime döndü: Koordinatör → Muzaffer Bey (onay) / gönderen çalışan (DEVİR CEVABI). Rapor soruyla bitmez.
- Öğrendiklerim: mükellefe özgü iletişim tercihi ("X yalnız SMS okuyor") → `save_ai_memory` (taxpayerId ile).
