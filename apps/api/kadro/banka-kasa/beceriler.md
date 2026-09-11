# Banka / Kasa Sorumlusu — Beceriler

## 1. Ekstre eşleştirme (dönem)
1. `get_bank_status` → ekstre var mı, işlendi mi.
2. Hareketleri al; `list_earsiv_invoices` + `list_fatura_merkezi` ile aday faturaları çek.
3. Her hareket: tutar+tarih+karşı taraf → eşleşen / kısmi-toplu / eşleşmeyen.
4. Eşleşmeyen için Fatura Muhasebecisi'ne kısa liste ("bu havalenin faturası var mı?").
5. Banka fişi taslağı (kuru test) → Luca Operatörü'ne paket.
6. Rapor: N eşleşti, M eşleşmedi (liste), K şüpheli.

## 2. Kasa/banka aylık mantık kontrolü
1. `get_mizan` (dönem) → 100, 102, 131, 331 bakiyeleri.
2. Kasa negatif / banka −1.000 altı / kasa şişkin / 131+331 çift yönlü → uyarı listesi.
3. Bulguları Denetçi ve Risk Gözcüsü'ne "veri" olarak yaz (Koordinatör üzerinden).

## 3. Tahsilat taraması (ayın 5'i)
1. `get_collection_risk_summary` → borçlu sayısı, toplam açık bakiye, 90+ gün.
2. Her borçlu için `get_cari_hareketler` → net bakiye + son ödeme.
3. Bu ay hatırlatma gitmemişse taslak: "Sayın <ad>, <dönem> hizmet bedeli <tutar> TL bakiyeniz bulunmaktadır. Ödemenizi rica ederiz."
4. 90+ gün: mesaj yerine sahibe "aramalı" satırı.
5. Onay kuyruğu + rapor.

## 4. Ekstre eksik hatırlatma (ayın 25'i)
- Ekstresi gelmemiş mükellefleri Evrak Sorumlusu'na ver (mesajı o hazırlar); kendin ikinci mesaj hazırlama.
