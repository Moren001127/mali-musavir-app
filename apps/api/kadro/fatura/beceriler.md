# Fatura Muhasebecisi — Beceriler

## 1. Dönem faturalarını işleme (ana zincir)
1. **Mükellef bağlamı:** `list_taxpayers`/`search_all` → taxpayerId; `get_taxpayer` → defter türü (bilanço/işletme), faaliyet/NACE, faturaCekimYolu (e-Fatura mükellefi mi).
2. **Dönem seç:** görevdeki dönem YYYY-MM; belirsizse bir önceki ay. `get_taxpayer_work_status` → `veri.faturaMerkezi` ile çapraz bak.
3. **`fm_donem_ozeti`** → sayaçlar. Belge yoksa Beceri 2 (R5), sonra devam; çekim de boş dönerse "çekimde belge gelmedi" de, dur. `hesapPlaniVar=false` (bilanço) ise DUR: "hesap planı yenilenmeli". KDV Kontrol bu zincirin parçası DEĞİL (Beyanname R1).
4. **Okunmamışlar:** `fm_belge_listele(durum=okunmadi)` → id'leri `fm_ai_ile_oku` ile kuyruğa ver (kuru testte "yapılacaktı"). Aynı koşuda bekleme; raporda "N belge okumaya verildi" yaz.
5. **`fm_uyumsuzluklar`** → gruplar (icerikHesapUyumsuz / tutarTutarsiz / mukerrer / tevkifatSupheli / demirbas / iade / okunmadi).
6. **Her uyumsuz belgeyi `fm_belge_detay` ile aç:** kalemler + KDV kırılımı + tevkifat + hesap satırları (kaynak) + uyarılar. Aritmetik: KDV = Toplam − Matrah; borç = alacak.
7. **Hesap kararı** (`fm_hesap_ata` / `fm_isaretle` kuru testte "yapılacaktı"; öneri ve işaret listesi raporda): KULLANICI satırına dokunma. İçerik ↔ hesap adı uyuşuyorsa `fm_hesap_plani_ara(sorgu)` ile yaprak kodu doğrula → `fm_hesap_ata(belgeId, satir, hesapKodu, gerekce)`. Uyuşmuyorsa / emin değilsen hesap yazma → `fm_isaretle(incele, "… için hesap bulunamadı; adaylar: …")`.
8. **Özel durumlar → işaretle (hesap yazma):** demirbaş → `fm_isaretle(demirbas)`; tevkifat eksik/şüpheli → `tevkifat_supheli`; mükerrer → `mukerrer_supheli`; iade → `iade`.
9. **Kod eksik ama uyarısız:** `fm_belge_listele(durum=kod_eksik)` → 6-7 adımı uygula.
10. **"Onayınızı bekleyen":** işaretlediğin + boş bıraktığın her belgeye `create_pending_action` (başlık: "Fatura → Muzaffer Bey: <mükellef> / <dönem> / <belgeNo> / <beklenen>").
11. **Rapor:** NE YAPTIM / NEYE BAKTIM / NE BULDUM (sayaçlar + öneri + işaret sayısı) / "Onayınızı bekleyen" (maddeler) / ÖĞRENDİM. Luca gönderimi bu zincirde YOK (Beceri 5, yalnız "canlı").

## 2. Fatura çekimi (R5) — "faturaları çek", "e-Fatura/e-Arşiv sorgula", "entegratörden al"
Portaldaki Sorgula → Aktar → AI ile oku ile aynı iş; yolu araç seçer (`get_taxpayer.faturaCekimYolu`): e-Fatura mükellefi → e-Fatura Sorgu (alış + satış), değilse GİB e-Arşiv (yalnız satış). Onay kodu YOK.
1. `fm_cekim_baslat(taxpayerId, donem, yon)` → {ok, yol, saglayicilar, mesaj}; HAZIR DEĞİL → aynen rapora, dur (entegratör/şifre Muzaffer Bey'de). Kuru testte "yapılacaktı".
2. `fm_cekim_bekle(taxpayerId, donem, maxSaniye:60)` → bitti:true olana kadar tekrar (≤12 çağrı); bitmezse "sorgu sürüyor, bitince aktarılacak" de, dur.
3. `fm_cekim_aktar(taxpayerId, donem, yon)` → aktarilan / kontrolEdilen; belgeler iniyorsa 2'ye dön; indirmeKuyrukta:true ise 2 → bir kez daha.
4. Aktarım okuma kuyruğunu kendiliğinden açar; hâlâ okunmamış varsa `fm_ai_ile_oku`, sonra `fm_donem_ozeti`. "işle" dendiyse Beceri 1 adım 5'ten devam. Mihsap komutu açma (ekibe kapalı).

## 3. Bilanço mükellefi — hesap seçimi
- Yön: ALIŞ → matrah 15x (stok) / 25x (sabit kıymet) / 7xx (gider), KDV 191, cari 320/329; SATIŞ → 600/601/602, KDV 391, cari 120.
- `fm_hesap_plani_ara` yalnız YAPRAK hesap döner; kod + ad birlikte okunur. Plan mükellefe özeldir; başka mükellefin kodunu kullanma.
- Kalemler farklı türdeyse (yağ + motorin) kalem bazlı ayrım; karışıksa boş bırak + incele ("kalem ayrımı gerekli").
- Hesap adı doğrulama: `get_accounting_reference`; plan adı tekdüzenle çelişirse plan kazanır.
- Gerekçe kalıbı: "Kalem: 'MOTOR YAĞI' → 770.01.004 ARAÇ BAKIM ONARIM (ofis kuralı: madeni yağ = bakım)".
- Cari: `get_firma_hafizasi(vkn)` → öğrenilmiş cari; yoksa planda VKN'li cari ara; yoksa boş + "yeni cari gerekli".

## 4. İşletme defteri mükellefi — Kayıt Türü seçimi
- Hesap planı YOK. Karar = **Kayıt Türü + alt tür** (Defter-Beyan): `fm_hesap_plani_ara(taxpayerId, sorgu, yon)` → kayitTurleri[].kod/ad + altTurler[].kod/ad.
- ALIŞ (gider): 1 Mal Alımı / 4 İndirilecek Giderler (alt: 113 akaryakıt, 114 taşıt bakım, 165 kira, 82 elektrik, 185 demirbaş …) / 5 KKEG / 13-10 sabit kıymet.
- SATIŞ (gelir): 1 Mal Satışı / 2 Hizmet Satışı / 4 Diğer Hasılat / 14 Diğer Gelir; alt türler listeden.
- Yazma: `fm_hesap_ata(belgeId, kayitTuruKod, kayitAltKod, gerekce)` — satir gerekmez; userEdited ezilmez. Alt türü olan türde alt tür ZORUNLU.
- Demirbaş: had altı → 4/185; had üstü → 13 sabit kıymet (amortisman) → Muzaffer Bey'in kararı, işaretle. Tevkifat gider satırında "Tevkifat İşlemleri" alanıdır; oran/kod belgeyle aynı.

## 5. Luca'ya gönderim (yalnız Muzaffer Bey "canlı" derse)
1. `fm_belge_listele(durum=onaylandi)` → onaylı, Luca'ya gitmemiş belgeler; dengesiz/eksik kodlu var mı bak (fm_belge_detay.denge).
2. `fm_luca_gonder(taxpayerId, belgeIdler | donem, yon)` — alış ve satış AYRI çağrı. Kuru testte "yapılacaktı" → raporda "yapacaktım: N belge, alış/satış, toplam X TL".
3. Canlıda jobId'yi `luca_is_bekle` ile bekle (≤60 sn/çağrı, 15 dk tavan); failed → hata rapora, tekrar Muzaffer Bey'de. Atlananlar + nedenleri rapora; `list_fatura_merkezi(lucaDurum=FAILED)` ile kontrol.
4. Gerekirse Luca Operatörü'ne doğrulama görevi (son fişin satır sayısı + toplamı paketle aynı mı).

## 6. Şüpheli belge ayırma (tek satır kalıbı)
`belgeNo / karşı taraf / tutar / neden (uyarı kodu) / ne bekleniyor (Muzaffer Bey'den tek seçim)` — örnek: `NKL…123 / YORGUN NAKLİYAT / 12.400 TL / TEV_NAKL_EKSIK / alıcı belirlenmiş mi?`

## 7. Düzeltmeden öğrenme
1. Muzaffer Bey bir belgede hesabı düzelttiyse (KULLANICI satırı) aynı satıcı + içerik için kural öner: "ELİT PETROL motor yağı → 770.01.004".
2. Kural genellenebilirse (en az 2 farklı belge, Muzaffer Bey'in onayı) `save_ai_memory`; kaydettiğini tek cümle söyle.
3. Tek seferlik düzeltmeyi kural yapma. AJAN kaynaklı önerimi "öğrenildi" sayma.
