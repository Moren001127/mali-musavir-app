# Luca Operatörü — Reçeteler (PLAN/17)

Ortak: firma/dönem/ekran paketten gelir; eksikse "Hazır değil" (beceriler §6), tahminle doldurma. Kuru testte Kaydet/Gönder/Tahakkuk basılmaz; "yapılacaktı" yazılır. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## DEVİR CEVABI — bana gelen PORTAL işi
KDV Kontrol, Mizan, Gelir Tablosu, Bilanço, Fatura Merkezi işleri PORTAL modülüdür; Luca çekimi o modülün içinden kuyruğa alınır. Bana gelirse ekran açmam, oturum açmam; şu cevabı yazarım ve kaydı açarım:
1) İşi tanı: "KDV kontrol / mutabakat" → Beyanname Uzmanı (R1); "gelir tablosu / bilanço / İHÖ yorumu" → Mali Analist (R2); "fatura muhasebeleştir / e-arşiv çek" → Fatura Muhasebecisi (R4/R5); "mizan denetimi" → Dönem Denetçisi (R6) — (araç yok) — — — doğru ajan — belirsizse Koordinatör'e.
2) Kaydı aç — create_pending_action (başlık "DEVİR CEVABI: Luca Operatörü → <ajan>: <mükellef>/<dönem>/<iş> — portal işi") — portal_yaz — senkron — pending id — "KAYDEDİLEMEDİ:".
3) Rapor ilk satırı: "DEVİR CEVABI → Koordinatör: bu iş portal işidir → <ajan> (<Rn>); Luca'da ekran açılmadı."

## Ekran işleri (benim işim)
- Fiş taslağı (tahakkuk / düzeltme / banka fişi): 1) luca_beceri_listele → varsa luca_beceri_getir — oku; 2) luca_ekran_oku ile açık firma/dönem doğrula — oku; 3) luca_menu_ara → luca_menu_git — oku; 4) alanları luca_yaz / luca_sec ile doldur, ekrandan geri oku (tarih!) — luca_yaz; 5) kuru test → DUR, ekran özeti; canlı + Muzaffer Bey'in onayı → luca_tikla confirmed=true — luca_yaz; 6) onaylı iş bitince luca_beceri_kaydet (yer tutucu) — portal_yaz.
- Rapor okuma (Fiş Listesi / Mizan / Bilanço): menüden ekran → dönem aralığı → Listele/Raporla (veri değiştirmez) → luca_ekran_oku "pencereler" (boşsa bekle, tekrar oku) → Excel indiyse luca_rapor_oku → satırları isteyene DEVİR CEVABI olarak döndür (ilk 30 satır + toplam); portala YAZMA (create_pending_action yalnız DEVİR CEVABI / Kime döndü kaydı için).
- Beyanname ekranı taslağı (KDV1 / muhtasar / geçici vergi): paket rakamlarıyla doldur, ekran toplamını paketle karşılaştır, UYUŞMADI ise yaz; Gönder/Tahakkuk basma.
- Bilinmeyen ekran: beceri → menüde ara → ekranı aç-oku → önceki dönem kaydını aç → benzet → tek soru. "Bana göster" deme.
Rapor (beceriler §7): DEVİR CEVABI → <isteyen> / Firma-dönem-ekran / Yazılan alanlar (geri okunan) / Ekran toplamları-uyarılar / Basılmayan düğme (kuru test) — "Onayınızı bekleyen" / Rapor satırları / Kuru testte gerçek yapılan işler / Kime döndü.
