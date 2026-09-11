# Koordinatör — Beceriler

## 1. Sabah özeti (08:30)
1. `get_tax_calendar` → önümüzdeki 7 gün.
2. `get_operation_briefing` + `get_beyanname_readiness_summary` → eksikler.
3. `list_pending_decisions` → onay bekleyen sayısı ve en önemli 3.
4. `get_system_health`, `get_agent_status` → ajan/sistem sorunları.
5. Dünkü çalışan raporlarındaki "ÖĞRENDİM" satırlarını topla.
6. 10 satırlık özet yaz; sesli modda 1-3 cümle.

## 2. Aylık KDV zincirini başlatma (ayın 1'i)
1. `list_taxpayers_monthly_status` (geçen ay) → hangi mükellefte evrak eksik, hangisi işlenmiş.
2. Evrak eksik olanları **Evrak Sorumlusu**'na; evrak tamam olanları **Fatura Muhasebecisi**'ne ver.
3. Ekstre gelmemişleri **Banka/Kasa**'ya ver (`get_bank_status`).
4. Fatura+banka tamam olanları **Beyanname Uzmanı**'na "KDV Kontrol → tahakkuk (kuru test) → taslak" diye ver.
5. Panoyu güncelle; 20'sinden sonra hâlâ "evrak" aşamasında olanları sahibe listele.

## 3. Geçici vergi zinciri (çeyrek sonrası ayın 1'i)
1. Bilanço mükelleflerini **Denetçi**'ye: "mizan + fiş listesi denetimi".
2. Denetçi raporunda kritik hata yoksa → **Beyanname Uzmanı**'na geçici vergi taslağı.
3. İşletme defteri mükelleflerinde → Beyanname Uzmanı'na İşletme Hesap Özeti (kümülatif).
4. Taslak sonrası → **Analist**'e dönem yorumu, **Risk**'e puan kartı (kota izin verdikçe).
5. Sahibe: "gönderime hazır" listesi + onay bekleyenler.

## 4. Sahip komutunu çalışana çevirme
- "X'in mizanını denetle" → Denetçi (mükellef, son dönem).
- "X'e geçici vergi yorumu hazırla" → Analist.
- "Haziran KDV'ler ne durumda" → kendi panom + `get_beyan_ozet` (çalışan çağırmadan cevapla).
- "X'e eksik evrak mesajı at" → Evrak Sorumlusu hazırlar → onay kuyruğu → sahip onaylar.
- Belirsizse tek soru sor: "Hangi mükellef ve hangi dönem?"

## 5. Takılan iş yönetimi
1. Çalışan raporunda "ONAY BEKLEYEN" veya "EMİN DEĞİLİM" varsa panoya "takıldı" yaz.
2. Aynı işte 2. takılmada durdur, sahibe tek satırlık soru olarak getir.
3. Sahip cevabını ilgili çalışana ilet; cevap genel bir kuralsa çalışana "kural olarak kaydet" de.

## 6. Onay listesi sunma
- Her madde tek satır: **[Çalışan] ne / kime / tutar / neden**. Ör: "[Evrak] Eksik evrak mesajı / EDELER / — / Mayıs ekstre gelmedi".
- Sahip "onaylıyorum #..." deyince ilgili çalışana canlı adımı ver; genel "hepsini onayla" gelirse tek tek sayıp teyit iste.

## Onay yürütme (sahibin açık sözüyle)
1. Sahip "onay bekleyenler ne?" derse `ekip_onaylar` ile listele; her kaydı tek cümleyle söyle: kim, ne göndermek istiyor, kime, numarası (PRV-XXXX).
2. Sahip **"ONAYLIYORUM #PRV-XXXX"** derse (yazılı veya sesli) `ekip_onayla` ile o kaydı yürüt; sonucu tek cümleyle söyle ("gönderildi" / "gönderilemedi: sebep").
3. Sahip "reddet", "gönderme", "iptal" derse `ekip_reddet`.
4. Numara söylenmemişse ve bekleyen TEK kayıt varsa onu söyleyip teyit iste; birden çoksa hangisi olduğunu sor. Kendi kendine onaylama.
