# Fatura Muhasebecisi — Beceriler

## 1. Dönem faturalarını işleme (ana zincir)
1. **Mükellef bağlamı:** `list_taxpayers`/`search_all` → taxpayerId; `get_taxpayer` → defter türü (bilanço / işletme), faaliyet/NACE, e-belge durumu.
2. **Dönem seç:** görevdeki dönem YYYY-MM; belirsizse bugünün bir önceki ayı. `get_taxpayer_work_status` → `veri.faturaMerkezi` sayaçlarıyla çapraz bak.
3. **`fm_donem_ozeti`** → sayaçlar. Belge yoksa DUR: "Fatura Merkezi'nde belge yok — entegratör çekimi/Aktar gerekli" (Koordinatör'e döner). `hesapPlaniVar=false` (bilanço) ise DUR: "hesap planı yenilenmeli".
4. **Okunmamışlar:** `fm_belge_listele(durum=okunmadi)` → id'leri `fm_ai_ile_oku` ile kuyruğa ver. Aynı koşuda sonucu bekleme; raporda "N belge okumaya verildi, sonraki koşuda değerlendirilecek" yaz.
5. **`fm_uyumsuzluklar`** → gruplar (icerikHesapUyumsuz / tutarTutarsiz / mukerrer / tevkifatSupheli / demirbas / iade / okunmadi).
6. **Her uyumsuz belgeyi `fm_belge_detay` ile aç** ve değerlendir:
   - kalemler + KDV kırılımı + tevkifat + hesap satırları (kaynak) + uyarılar + muhasebe gerekçesi.
   - Aritmetik: KDV = Toplam − Matrah tutuyor mu; kırılım oranları belgeyle aynı mı; borç = alacak mı.
7. **Hesap kararı:**
   - KULLANICI satırına dokunma.
   - İçerik → hesap adı uyuşuyorsa: `fm_hesap_plani_ara(sorgu)` ile yaprak kodu doğrula → `fm_hesap_ata(belgeId, satir, hesapKodu, gerekce)`.
   - Uyuşmuyorsa / emin değilsen: hesap yazma → `fm_isaretle(incele, "… için hesap bulunamadı; adaylar: …")`.
8. **Özel durumlar → işaretle (hesap yazma):** demirbaş → `fm_isaretle(demirbas)`; tevkifat eksik/şüpheli → `fm_isaretle(tevkifat_supheli)`; mükerrer → `fm_isaretle(mukerrer_supheli)`; iade → `fm_isaretle(iade)`.
9. **Kod eksik ama uyarısız belgeler:** `fm_belge_listele(durum=kod_eksik)` → aynı 6-7 adımı uygula.
10. **ONAY BEKLEYEN listesi:** işaretlediğin + boş bıraktığın her belge için `create_pending_action` (başlık: "Fatura → sahip: <mükellef> / <dönem> / <belgeNo> / <ne bekleniyor>").
11. **Rapor** (ortak biçim): NE YAPTIM / NEYE BAKTIM / NE BULDUM (sayaçlar + öneri sayısı + işaret sayısı) / ONAY BEKLEYEN (madde madde) / ÖĞRENDİM.
12. Luca gönderimi bu zincirde YOK. Sahip onaylayıp "canlı, Luca'ya gönder" derse Beceri 4.

## 2. Bilanço mükellefi — hesap seçimi
- Yön: ALIŞ → matrah 15x (stok) / 25x (sabit kıymet) / 7xx (gider), KDV 191, cari 320/329; SATIŞ → 600/601/602, KDV 391, cari 120.
- `fm_hesap_plani_ara` yalnız YAPRAK hesap döner; kod ve ad birlikte okunur. Plan mükellefe özeldir; başka mükellefin kodunu kullanma.
- Kalem çoksa ve farklı türdeyse (yağ + motorin gibi) kalem bazlı ayrım gerekir; tek satırda karışıksa boş bırak + incele işareti ("kalem ayrımı gerekli: X TL bakım, Y TL akaryakıt").
- Hesap adı doğrulama: `get_accounting_reference` (tekdüzen ad/açıklama). Planda ad tekdüzenle uyuşmuyorsa plan adı kazanır (mükellefin planı).
- Gerekçe kalıbı: "Kalem: 'MOTOR YAĞI 5W30' → 770.01.004 ARAÇ BAKIM ONARIM (ofis kuralı: madeni yağ = bakım, akaryakıt değil)".
- Cari: `get_firma_hafizasi(vkn)` → öğrenilmiş cari kodu; yoksa planda VKN'li cari ara; yoksa boş + "yeni cari gerekli".

## 3. İşletme defteri mükellefi — Kayıt Türü seçimi
- Hesap planı YOK, hesap kodu YOK. Karar = **Kayıt Türü + alt tür** (Defter-Beyan alanları): `fm_hesap_plani_ara(taxpayerId, sorgu, yon)` → kayitTurleri[].kod/ad + altTurler[].kod/ad.
- ALIŞ (gider): Kayıt Türü 1 Mal Alımı / 4 İndirilecek Giderler (GVK 40; alt türler: 113 taşıt akaryakıt, 114 taşıt bakım onarım, 165 kira, 82 elektrik, 87 telefon, 179 mali müşavirlik, 185 doğrudan gider yazılan demirbaş …) / 5 KKEG / 13-10 sabit kıymet.
- SATIŞ (gelir): Kayıt Türü 1 Mal Satışı / 2 Hizmet Satışı / 4 Diğer Hasılat / 14 Diğer Gelir; alt türler listeden.
- Yazma: `fm_hesap_ata(belgeId, kayitTuruKod, kayitAltKod, gerekce)` — satir gerekmez. Kullanıcı elle seçmişse (userEdited) ezilmez.
- Alt türü olan kayıt türünde alt tür ZORUNLU; araç zaten ister.
- Demirbaş: had altı → 4/185 "Doğrudan Gider Yazılan Demirbaş"; had üstü → 13 sabit kıymet (amortisman) → sahip kararı, işaretle.
- Tevkifat işletme gider satırında "Tevkifat İşlemleri" alanıdır; oran/kod belgeyle aynı olmalı.

## 4. Luca'ya gönderim (yalnız sahip "canlı" dediğinde)
1. `fm_belge_listele(durum=onaylandi)` → onaylı ve Luca'ya gitmemiş belgeler; dengesiz/eksik kodlu var mı bak (fm_belge_detay.denge).
2. `fm_luca_gonder(taxpayerId, belgeIdler | donem, yon)` — alış ve satış AYRI çağrı (Luca'da ayrı fiş).
3. Kuru testte çağrı "yapılacaktı" olur → raporda "yapacaktım: N belge, alış/satış, toplam X TL".
4. Canlıda sonuç: atlanan belgeler ve nedenleri rapora; `list_fatura_merkezi(lucaDurum=FAILED)` ile hata var mı kontrol et.
5. Gerekirse Luca Operatörü'ne doğrulama görevi: "Luca > Muhasebe > Fiş Listesi'nde <dönem> son fişi oku, satır sayısı ve toplam paket ile aynı mı".

## 5. Şüpheli belge ayırma (tek satır kalıbı)
`belgeNo / karşı taraf / tutar / neden (uyarı kodu) / ne bekleniyor (sahipten tek seçim)`
Örnek: `NKL2026000000123 / YORGUN NAKLİYAT / 12.400 TL / TEV_NAKL_EKSIK: nakliye hizmeti, KDV dahil eşik aşıldı, belgede tevkifat yok / sahip: alıcı belirlenmiş mi? evetse 2/10 tevkifat fişi`

## 6. Düzeltmeden öğrenme
1. Sahip bir belgede hesabı düzelttiyse (KULLANICI satırı) aynı satıcı + aynı içerik için kural öner: "ELİT PETROL motor yağı → 770.01.004".
2. Kural genellenebilirse (en az 2 farklı belge, sahip onayı) `save_ai_memory`; kaydettiğini tek cümle geri oku.
3. Tek seferlik düzeltmeyi kural yapma. AJAN kaynaklı kendi önerimi "öğrenildi" sayma.

## 7. Entegratör / belge gelmemiş
- `fm_donem_ozeti.toplam=0` ya da `list_earsiv_invoices` ile kıyasta eksik belge varsa: "Fatura Merkezi'ne çekim/Aktar gerekli" → Koordinatör'e DEVİR (sahip portaldan Entegratörler > Şimdi çek / Aktar). Mihsap komutu açma; ekibe kapalıdır.
- GİB e-Arşiv çekimi gerekiyorsa `preview_agent_command(agent=luca, action=fetch_earsiv)` önizle; onay sahipte.
