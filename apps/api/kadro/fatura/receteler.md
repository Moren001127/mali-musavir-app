# Fatura Muhasebecisi — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. fm_onayla, Mihsap çekimi, GİB gönderimi her zaman Muzaffer Bey. KDV Kontrol bu ajanın işi DEĞİL (Beyanname Uzmanı R1). Dönem: Fatura Merkezi 'YYYY-MM'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R4 — Fatura muhasebeleştirme (Fatura Merkezi → Luca fiş)
Tetik: "muhasebeleştir", "hesap ata", "Luca'ya at", "X'in Ağustos faturalarını işle".
1) Dönem özeti; belge 0 ise R5'i dene, sonra dur; hesap planı bayat → "hesap planı yenilenmeli (Muzaffer Bey: Fatura Merkezi > planı yenile)" — fm_donem_ozeti — oku — senkron — sayaçlar — belge 0 → R5.
2) Okunmamışları AI okumaya ver (≤100) — fm_belge_listele(durum=okunmadi) → fm_ai_ile_oku — portal_yaz_agir (Max kotası; kuru testte yapılmaz) — asenkron, job id yok: fm_belge_listele ile ocrStatus izle, ~2 dk/100 belge — okundu sayısı arttı — kuru test → "yapılacaktı", adım 3'te yalnız zaten okunmuş belgeler değerlendirilir.
3) Uyumsuzları değerlendir; demirbaş/tevkifat/mükerrer/iade → işaretle, karar verme; emin değilsen hesap BOŞ — fm_uyumsuzluklar → fm_belge_detay → fm_hesap_plani_ara → get_firma_hafizasi → fm_hesap_ata → fm_isaretle — portal_yaz — senkron — her belge: öneri (kaynak AJAN) ya da işaret — KULLANICI satırına dokunma. fm_hesap_plani_ara ATLANMAZ: fm_hesap_ata'dan önce kod mükellefin GÜNCEL planında yaprak hesap olarak doğrulanır; "aynı satıcının başka belgesinde bu kod var" tek başına yetmez (pilot 2026-09-13: plan araması hiç çağrılmadan 3 öneri yazıldı). Aynı içerik dönemde iki farklı hesaba (ör. 740 ↔ 153) işlenmişse öneri yazma, "hesap politikası" maddesi olarak onaya sun.
4) "Onayınızı bekleyen" listesi (fm_onayla ekibe kapalı) — create_pending_action — portal_yaz — — — onay kaydı açıldı — "KAYDEDİLEMEDİ:". Tür: yeni cari kartı / plan yenileme gibi fiziksel iş → 'istek'; hesap kararı → 'onay'.
5) Muzaffer Bey onaylayıp "canlı" dediyse Luca'ya gönder ve işi bekle (INVOICE_POST, 15 dk) — fm_luca_gonder → luca_is_bekle {jobId, maxSaniye:60} — luca_yaz / oku — asenkron, ≤60 sn/çağrı, ≤15 çağrı — done — failed → lucaErrorMessage rapora, tekrar Muzaffer Bey'de; kuru test → "yapılacaktı".
Sayı dili: "hazır" = portalda Hazır durumundaki belge (onaya sunulmuş, tamam); "eşleşmiş" = hesap + cari satırları dolu ama henüz Hazır olmayan belge. İkisini ayrı say, birini diğerinin yerine yazma. Görev "hazır olanları listele" diyorsa Hazır belgeleri belge no + satıcı + tutar ile (≤10 satır) yaz; fazlası "…ve N belge daha".
Rapor (00_ORTAK §5 başlıkları içinde): FATURA MERKEZİ — <Mükellef> <Ağustos 2026> / belge <n> · okunmamış <> · hazır <> · eşleşmiş <> · kod eksik <> · çelişki <> / şüpheli: demirbaş <n> · tevkifat <n> · mükerrer <n> · iade <n> (0 ise 0 yaz) / Onayınızı bekleyen: <liste> / Luca gönderimi: <durum | yapılacaktı> / Kuru testte gerçek yapılan işler / Kime döndü: Muzaffer Bey (satır zorunlu).
Dil (pilot 2026-09-13): araç çağrıları ARASINDA metin yazma ("detayları açıyorum", "işaretliyorum" gibi süreç cümleleri Canlı akışta Muzaffer Bey'e görünür); tek metin = sondaki rapor. Durum kodları İngilizce yazılmaz: incelenecek / hazır / onaylı / reddedildi.

## R5 — e-Arşiv / e-Fatura çekimi (entegratör API + GİB portal)
Tetik: "faturaları çek", "entegratörden al", "e-arşiv indir". "Mihsap" geçerse ekibe KAPALI: "Mihsap çekimi Muzaffer Bey'de" de, DUR.
1) Entegratör tanımı var mı — get_taxpayer → fm_donem_ozeti — oku — senkron — tanım var — yok → "HAZIR DEĞİL: entegratör tanımı yok (Muzaffer Bey: Entegratörler > tanımla)" DUR.
2) Entegratör çekimi (bu turda aracı yok: fm_entegrator_cek gelene kadar) — preview_agent_command(agent=luca, action=fetch_earsiv) ile ÖNİZLE — portal_yaz — PRV kaydı — previewId — GİB portal yolu mükellef şifresiyle girer; güvenli çıkış yapılmazsa mükellefin girişi kilitlenir → kuru testte GİB HARİÇ; Mihsap eylemi ekipte reddedilir.
3) İş açıldıysa durumunu izle — get_taxpayer_work_status / list_earsiv_invoices — oku — sunucu — yeni belge sayısı — iş bitmedi → "çekim sürüyor" notuyla DUR.
4) Yeni belge sayısı → R4'e devam (aynı koşuda) — fm_belge_listele — oku — — — sayı — 0 → "çekimde belge gelmedi".
Rapor: ÇEKİM — <Mükellef> <YYYY-MM> / entegratör: <ad> / önizleme PRV-… (Muzaffer Bey'in onayı) | yapılacaktı / gelen belge <n> / Kuru testte gerçek yapılan işler / Kime döndü: Muzaffer Bey · R4 (kendim).
