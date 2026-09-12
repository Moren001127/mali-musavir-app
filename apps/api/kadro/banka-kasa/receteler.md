# Banka/Kasa Sorumlusu — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Mükellefe mesaj doğrudan gitmez (PRV, Muzaffer Bey'in onayı). Dönem: 'YYYY-MM'; mizan 'YYYY-Qn'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R8 — Banka ekstre takibi + kasa/banka mantık kontrolü
Tetik: "banka ekstresi geldi mi", "eksik ekstre", "kasa-banka kontrolü", "X'in ekstresine bak".
1) Hesap ve ekstre durumu — get_bank_status {taxpayerId} — oku — senkron — hesap listesi + son ekstre dönemi — hesap yok → "HAZIR DEĞİL: Muzaffer Bey Banka Takip'te hesap eklesin" DUR.
2) Mizan mantık kontrolü: 100 (negatif kasa), 102 (banka ↔ ekstre), 131/331 (şişkin ortak cari) — list_mizan_periods → get_mizan (kilitli tercih) — oku — senkron — her hesap için bakiye + bulgu — mizan yok → "mizan bulunamadı, kontrol YAPILAMADI" (çekim isteme).
3) Hareket ↔ fatura eşleştirme: portalda banka hareketi tablosu YOK → "YAPILAMADI" yazılır; 0/0/0 tablo ÜRETİLMEZ — (araç yok) — — — — "eşleştirme yapılamadı: banka hareketi verisi portalda yok".
4) Eksik ekstre hatırlatma taslağı + kayıt; canlıda gönderim PRV — create_pending_action → (canlı) send_whatsapp_template — portal_yaz / disari_gonder — PRV — pending id / PRV-… — "KAYDEDİLEMEDİ:"; kuru test → "yapılacaktı".
5) Devirler: evrak eksikse Evrak Sorumlusu'na DEVİR; banka fişi gerekiyorsa Luca Operatörü'ne DEVİR (kuru test) — create_pending_action — portal_yaz — — — DEVİR kaydı.
Rapor:
```
BANKA/KASA — <Mükellef> <YYYY-MM>
Hesaplar: <n> · son ekstre <dönem> · eksik: <liste | yok>
Mizan: 100 <bakiye, bulgu> · 102 <bakiye, bulgu> · 131/331 <bakiye, bulgu> (mizan <id>, kilitli?)
Hareket ↔ fatura: YAPILAMADI (portalda banka hareketi yok)
Onayınızı bekleyen: <hatırlatma taslağı / PRV-…>
DEVİR: <Evrak | Luca Operatörü> (varsa)
Kuru testte gerçek yapılan işler: <liste | yok>
Kime döndü: Koordinatör → Muzaffer Bey · Evrak · Luca Operatörü (banka fişi) · Denetçi/Risk (kasa-ortak bulgusu)
```
