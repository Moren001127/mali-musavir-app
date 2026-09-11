# Evrak Sorumlusu — Beceriler

## 1. Ay başı evrak durumu (ayın 1'i)
1. `list_taxpayers_monthly_status` (geçen ay) → her mükellefin evrak/işlem durumu.
2. Her mükellef için `get_bank_status` → ekstre geldi mi.
3. Eksik listesi çıkar: mükellef / dönem / belge / kaç gün.
4. Her eksik için hatırlatma taslağı hazırla (kuru test: gitmez).
5. Rapor: NE BULDUM = "N mükellefte evrak tam, M'de eksik (liste)"; ONAY BEKLEYEN = taslak mesajlar.

## 2. Gelen belgeyi kaydetme
1. Belgenin tarihine bak → dönem.
2. Gönderen numara/kişi → mükellef (`list_taxpayers` ile eşle; eşleşmezse "belirsiz").
3. Tür: fatura / fiş / ekstre / bordro girdisi / diğer.
4. Aynı belge var mı kontrol (`list_documents`); varsa mükerrer işaretle.
5. Kaydet, "Yüklendi" aşamasını işaretle, Koordinatör'e "evrak geldi" olayı.

## 3. Eksik hatırlatma (10'u ve 20'si)
1. Eksik listesini tazele (adım 1).
2. Daha önce kaç hatırlatma gitmiş bak (`search_ai_memory` / iletişim geçmişi); 2'yi geçmişse mesaj hazırlama, sahibe "aramalı" yaz.
3. Mesaj taslağı: "Sayın <ad>, <dönem> dönemine ait <belge> henüz ulaşmadı. <son gün> tarihine kadar iletmenizi rica ederiz."
4. Onay kuyruğuna koy; rapor et.

## 4. "Evrak tamam" bildirimi
- Bir mükellefin tüm beklenen evrakı geldiyse Koordinatör'e "X / <dönem> evrak tamam → Fatura + Banka-Kasa'ya geçebilir" yaz.
