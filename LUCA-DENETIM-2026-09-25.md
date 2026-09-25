# LUCA VERİ ÇEKME / GÖNDERME DENETİMİ — 2026-09-25

Beş alanda paralel denetim + canlı veritabanı ölçümü. Kod değiştirilmedi.
Her bulgunun dosya:satır kanıtı var.

**Canlı ölçüm tabanı:** 4.267 Luca işi, son 30 gün 87 başarısız iş günlüğü,
3 çevrimiçi ajan, 2.020 alış belgesi.

---

## 1. NEDEN TAKILIYOR — üç kök sebep

Ekrandaki "İşleniyor 0/1 · 0 çalışıyor, 1 sırada" belirtisinin üç bağımsız
sebebi var. Kuyruk ve ajan denetimleri **birbirinden bağımsız olarak aynı üçünü**
buldu.

**Canlı kanıt:** hedefi belirtilmemiş 207 işin tamamı hiç başlamadan ölmüş
(192 iptal, 15 hata). Sunucuya yönlendirilenler %79 ve %96 ile çalışıyor.

| Hedef | İş | Başarılı | Hiç başlamamış |
|---|---|---|---|
| `vps-radore-luca` | 1097 | 867 (%79) | 28 |
| `moren-...-operator` | 190 | 183 (%96) | 12 |
| **hedef boş** | **207** | **0** | **207** |

### 1.1 [KRİTİK] Sonsuz "tekrar sıraya al" döngüsü
`apps/api/src/luca/luca.service.ts:1165-1207` + `apps/luca-local-agent/src/agent.js:2528, 2570`

Ajanın takılma bekçisi işi 4 dakikada bir sıraya geri atıp kendini öldürüyor.
Sunucu bu gerekçeyi "teknik kurtarma" saymadığı için deneme sayacını **sıfırlıyor**:

```ts
const isTechnicalRecovery = /TRANSIENT_LUCA|runtime toparlanamadi|classic frame|firma frame|browser oturumu/i.test(recoveryReason);
const nextRetryCount = isTechnicalRecovery ? Number(job.retryCount || 0) + 1 : 0;
```

Bekçinin gönderdiği gerekçeler (`AGENT_STALL_WATCHDOG_4MIN`, `AGENT_FREEZE_WATCHDOG`,
`AGENT_SELF_HEAL_TIMEOUT_10MIN`) bu kalıba **uymuyor**. Sonuç: iş sonsuza kadar
sıra ↔ çalışma arasında salınır, hiç başarısız olmaz, hiç bildirim çıkmaz.
Sunucudaki üç ayrı "3 denemede dur" emniyeti aynı sayacı kullandığı için hepsi
devre dışı kalır.

Ajan günlüğünde 44 kez `agent exit code=7` (takılma kill'i) kaydı var.

**Düzeltme:** gerekçeye bakmadan her yeniden sıraya almada sayacı artır;
sıfırlamayı yalnız iş gerçekten bittiğinde yap.

### 1.2 [KRİTİK] İş, onu alması yasak olan cihaza çivileniyor
`luca.service.ts:251-266, 1243-1247, 1291-1297` + `apps/web/src/hooks/useLucaAgent.ts:57-63`

İki ayrı yönlendirme alanı var ve birbirini hiç doğrulamıyor:
- `preferredAgent` — e-arşiv işlerine otomatik `local-node` yazılıyor
- `targetDeviceId` — ekran cihazı `/vps|headless|runner|radore/` kalıbıyla seçiyor

Bu kalıp **operatör cihazını da yakalıyor** (`vps-radore-luca-operator`). Cihaz adı
`-operator` ile bittiği için ajan türü `operator` sayılıyor, ama iş `local-node`
istiyor → **hiçbir ajan alamıyor**. İş 24 saat bekleyip sessizce iptal ediliyor.

Operatör 5 saniyede bir, veri ajanı 30 saniyede bir ping atıyor; liste son ping'e
göre sıralı olduğu için seçim çoğunlukla operatöre düşüyor.

**Düzeltme:** iş yaratılırken iki alanın uyumunu doğrula; uymuyorsa çiviyi düşür.
Cihaz seçici operatör cihazını listelemesin.

### 1.3 [KRİTİK] Kuyruk başı tıkanması
`luca.service.ts:1305-1306` + `agent.js:1886-1889`

```ts
orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
take: 5,
```

Ajana bir seferde yalnız 5 iş, en eskiden sıralı veriliyor. Alınamayan bir iş her
yoklamada yine ilk sırada döner; 5 böyle iş kuyruğu 24 saat tamamen kilitler.

Ajan desteklemediği tipi **sessizce atlıyor**, sunucuya hiçbir şey bildirmiyor.
Ajanın desteklediği tip listesi ping ile sunucuya geliyor ama kuyruk bunu
kullanmıyor. **Bu makinenin `config.json` listesinde `INVOICE_POST` yok** — yani
bu ajan Luca aktarım işlerini görse de yapmıyor.

**Düzeltme:** ping'deki tip listesini süzgeçte kullan; teklif edilip alınmayan işi
kuyruğun sonuna at.

### 1.4 [KRİTİK] Giriş kilidi açık kalırsa ajan hiç iş almaz
`agent.js:668-705` + `agent-runtime.js:2056`

`moren_node_giris=1` çerezi varken `__lucaJobRunning` sabit `true` okutuluyor;
iş döngüsü ilk kapıda dönüyor. Kilidi kaldırma yolu hata yutuyor. Watchdog'lar
tarayıcıyı kapatmadan prosesi öldürdüğü için kilit açık kalabiliyor.

Bu hâlde ajan sunucuya "çalışıyor" ping'i atmaya devam eder — **portaldaki yeşil
"ajan açık" yazısı bundan gelir** — ama hiçbir iş başlamaz.

**Düzeltme:** kilide zaman aşımı koy (3 dk sonra kendini açan çerez); prosesi
öldürmeden önce kilidi kaldır.

### 1.5 [YÜKSEK] Sebep kullanıcıya hiç ulaşmıyor
- `luca.service.ts:1265-1287` — "aynı mükellefte başka iş çalışıyor" açıklaması
  pratikte hiç yazılmıyor (süzgeç işi listeden çıkardığı için o kod yolu çalışmıyor)
- `luca.controller.ts:640` — iş alınamadığında sebep dönmüyor (`claimed:false`, o kadar)
- `luca.service.ts:647-654` — takılı iş temizliği **kullanıcının canlı günlüğünü siliyor**,
  bildirim üretmiyor, KDV oturumunu "işleniyor"da bırakıyor
- `luca.controller.ts:1233-1262, 853-940` — KDV ve Mizan yükleme uçları hatayı işe
  hiç yazmıyor; kullanıcı "Excel başlığı tanınmadı" yerine "üst süre aşıldı" görüyor

---

## 2. NEDEN YAVAŞ — ölçüm

**Sayım:** `agent-runtime.js` içinde **239 sabit bekleme** (toplam değer 195 saniye),
`agent.js` içinde 14 tane daha (30 saniye).

**Tek fiş kesme işinde biriken kör bekleme: 40-70 saniye.**
Luca'nın kendi yanıt süresi tipik 10-20 saniye.
→ **Yavaşlığın baskın kaynağı Luca değil, bizim beklemelerimiz (2-4 kat).**

| Bölge | Çağrı | Toplam |
|---|---|---|
| Fiş Kes + İşlem Takip | 20 | 42,5 sn |
| Excel yükleme / HIZLI FİŞ | 30 | 37,3 sn |
| Fiş aktarım ekranı | 12 | 12,2 sn |
| e-Arşiv ZIP çekimi | 22 | 11,5 sn |
| Firma seçimi | 4 | 7,6 sn |

**Neden başka programlar hızlı:** onlar "hazır olunca devam et" kullanıyor. Bizde
rapor/form açma yolları akıllı, ama **tıklama sonrası oturma beklemeleri neredeyse
tamamen kör**. Her tıklamada sabit uyku var:

```js
if (res && res.ok) { await sleep(opts.settleMs || 800); return true; }
```

24 tıklama noktası × 800-2000 ms. Fiş kesme yolundaki ~20 bekleme noktasının
**15'i kör, 5'i akıllı**.

### Gizli maliyet — tıklama başına DOM taraması
`agent.js:987-1085`

Her tıklama Playwright köprüsünden geçiyor ve **tüm frame'lerde
`document.querySelectorAll('*')` ile tam DOM taraması × 2** yapıyor. Bulunamayan
tek bir düğme **6-8 saniye + onlarca tam tarama** demek.

### Gereksiz tekrar
- **Runtime her işte yeniden indiriliyor** — 703 KB, her iş başına (`agent.js:1198`)
- **Her işte menüye baştan gidiliyor** — ~6,5 sn kör bekleme
- **Firma turu işi başlatmadan bitiyor** → 15 saniye boşa, sonra menüden TEKRAR başlıyor
- **Hızlı yol ipucu kullanılmıyor** — aynı mükellef için firma değişimi gereksiz
  ama `ensureLucaFirma` koşulsuz çağrılıyor

### Güvenli hızlandırma (tahmini kazanç)

| Değişiklik | Kazanç | Risk |
|---|---|---|
| Tık sonrası `settleMs` → akıllı bekleme | 12-25 sn/iş | düşük |
| Navigasyon sonrası kör tamponlar (4500/4500/3000/3500) | 8-12 sn/iş | düşük |
| Fiş kesme sonrası teşhis beklemeleri koşula bağla | 8-10 sn | düşük |
| Firma turundan sonra 15 sn beklemeyi kaldır | 15 sn/iş | orta |
| DOM taramasını daralt (`*` yerine hedefli seçici) | tık başına yüzlerce ms | düşük-orta |
| Runtime indirmesini önbelleğe al | 0,5-2 sn + 703 KB/iş | düşük |
| `ensureLucaFirma` 3500 ms → 500 ms | 3-6 sn | orta (ölçülmeli) |

**Toplam beklenen kazanç: iş başına 45-70 saniyeden 15-25 saniyeye.**

### DOKUNULMAMALI (bilerek konmuş)
- e-Arşiv `STABIL_NO_CHANGE_MS = 90000` — 30 sn'den bilerek çıkarılmış, kaçan fatura vakası
- 45 saniyelik ilerleme satırı — sunucunun 150 sn sessizliği takılma sayması yüzünden
- Güvenlik kodu denemeleri arası beklemeler — Luca her yanlışta yeni kod üretiyor
- Giriş için 90 saniyelik bekleme — hesap kilidi koruması

---

## 3. SESSİZ VERİ RİSKLERİ — bunlar bildirim vermiyor

Bu bölüm en önemlisi: hepsi **şu an ekranda "başarılı" görünüyor**.

### 3.1 [KRİTİK] Mihsap'a çift yükleme — mükellefin defterine çift gider
`apps/api/src/earsiv/earsiv.service.ts:209-259` + `e-arsiv/page.tsx:522-532`

Döngü `mihsapUploadStatus` / `mihsapUploadedAt` alanlarını **hiç kontrol etmiyor**,
yalnız belge tipine bakıyor. Ekrandaki seçim süzgeci de aynı. Mihsap ucu kör dosya
gönderimi, kendi tarafında mükerrer elemesi yok.

**İkinci kez "Mihsap'a Yükle" tıklanırsa aynı gider faturası iki kez düşer.**

### 3.2 [KRİTİK] Aynı belge numaralı iki fatura aynı dosyaya yazılıyor
`earsiv.service.ts:84-108`

Dosya anahtarı: `.../{donem}/{yon}-{kaynak}/{faturaNo}.pdf` — **satıcı ve ETTN yok**.
Veritabanı satırları doğru ayrışıyor (kısıt satıcıyı içeriyor) ama ikisi de **aynı
PDF'i** gösteriyor; ikinci yükleme birincinin üzerine yazıyor.

Canlı örnek bu kalıpta mevcut (GIB2026000000083 iki ayrı satıcıda).
Sonuç: "Aç/Yazdır"da yanlış fatura, Mihsap'a yanlış PDF.

### 3.3 [KRİTİK] Luca listesinin 1. sayfası dışı çekilmiyor
`agent-runtime.js:7929-7937`

Ajan sayfalamayı görüyor ve günlüğe yazıyor:
`⚠ DİKKAT: Luca'da TOPLAM N fatura var ama tabloda sadece M görünüyor (pagination).
Bu sürümde sadece 1. sayfa indiriliyor`

Ama mutabakat sayacı **tablodaki satır sayısını** gönderiyor, Luca'nın toplamını
değil → eksik kontrolü hiç tetiklenmiyor, iş "Tamamlandı" bitiyor.

### 3.4 [KRİTİK] "Tamamlandı" işinin uyarıları ekranda görünmüyor
`e-arsiv/page.tsx:1084-1101, 462-479`

Sunucu "⚠️ EKSİK: Luca'da 30 belge görünüyordu, portala 25 işlendi" uyarısını iş
günlüğüne yazıyor. Ekran bu satırı yalnız **çalışan** ve **başarısız** işlerde
gösteriyor. İş `done` olunca sadece "Tamamlandı" rozeti var ve **15 saniye sonra
günlük tamamen siliniyor**.

### 3.5 [KRİTİK] Gerçek hata "Fatura yok" diye görünüyor
`earsiv.service.ts:404-407` + `page.tsx:104-106`

Sunucu `ZIP içinde aktarılabilir fatura bulunamadı (xml=0, entries=12)` diyor.
Ekran bunu `/fatura bulunamadı/` kalıbına düşürüp **"Fatura yok: bu dönem için
kayıtlı fatura bulunamadı"** yazıyor.

Bozuk ZIP ile "o ay fatura yoktu" aynı görünüyor — kullanıcı tekrar çekmiyor.

### 3.6 [KRİTİK] Mizan önce siliniyor, sonra çekiliyor
`apps/api/src/mizan/mizan.service.ts:307-309`

`if (existing) { await mizan.delete(...) }` satırı Luca'dan dosya indirilmeden
**önce** çalışıyor. İndirme patlarsa eski mizanın hesap satırları gitmiş oluyor ve
geri getirilemiyor (`rawExcelKey` hiçbir yerde doldurulmuyor).

Elle yükleme yolu bunu doğru yapıyor (önce ayrıştır, sonra sil) — otomatik yol
aynı sırayı kullanmalı.

### 3.7 [KRİTİK] İşletme fiş kesmede çift fiş kapısı
`agent-runtime.js:4431, 4435`

Fiş Kes onay sinyali görünmezse İşletme yolu `throw` edip işi **FAILED** yapıyor →
ekranda "tekrar dene" düğmesi açılıyor. Oysa Bilanço yolunda aynı durum için karar
tam tersi ve gerekçesi kodda yazılı (`luca.service.ts:560-565`):

> *"Belgeyi FAILED yapmıyoruz: yükleme yapılmış olabilir, FAILED 'tekrar dene'yi
> açar ve ÇİFT FİŞ üretir."*

İşletme yolu bu korumanın dışında kalmış. Canlı günlükte bu hata 13 kez görülüyor.

### 3.8 [YÜKSEK] Kaç satırın kabul edildiği karşılaştırılmıyor
`agent-runtime.js:3767, 4470`

Kalıntı denetimi tek yönlü: **fazlası** yakalanıyor, **eksiği** yakalanmıyor. Luca
bir satırı reddedip düşürürse (ünvan/vergi dairesi hatası) fiş eksik kesilir ve
tüm belgeler yine POSTED olur.

### 3.9 [YÜKSEK] CSV sözlük hizalaması eksik alanları kapsamıyor
`agent-runtime.js:3601-3640` + `luca-excel.service.ts:304-334`

Ajan Luca'nın listelerini çekip CSV'yi düzeltiyor — ama yalnız KDV İSTİSNASI,
KAYIT ALT TÜRÜ, BELGE TÜRÜ(DB), ALIŞ/SATIŞ TÜRÜ, STOPAJ KODU için.

**SOYADI ÜNVAN, VERGİ DAİRESİ ve ADRES listede yok** — canlı hataların çıktığı üç
alan tam bunlar. Karşılığı bulunamayan değer yalnız günlüğe yazılıp **yükleme yine
de yapılıyor**.

Ünvan temizliği varsayılanda sadece Türkçe harf katlıyor; noktalama temizliği
`LUCA_ISLETME_UNVAN_ASCII='2'` ile açılıyor ve **kapalı**.

### 3.10 [YÜKSEK] Tarihi okunamayan fatura bugünün ayına yazılıyor
`earsiv-zip-parser.service.ts:440-443, 618-622`

`let faturaTarihi = new Date();` — tarih okunamazsa fatura bugünün dönemine düşüyor.
Kullanıcı Nisan'ı sorguladığında o fatura listede yok → sessiz kayıp gibi görünüyor.

### 3.11 [YÜKSEK] Dönem hesabı sunucu saatiyle yapılıyor
`luca-schedule.service.ts:102-103` + `apps/api/Dockerfile` (TZ ayarı yok)

Cron İstanbul saatine ayarlı ama dönem `new Date(...getMonth() - 1)` ile sunucu
saatinden (UTC) türetiliyor. **1 Eylül 02:00 İstanbul = 31 Ağustos 23:00 UTC** →
gece işi "2026-08" yerine "2026-07" çeker.

### 3.12 [ORTA] Süzgeç gerçek satırı eleyebilir, testi yok
`kdv-control/luca-row-filter.ts:20-37`

`if (!hasDate && !hasBelgeNo) return true;` — tarihi ve evrak numarası okunamamış
**gerçek** satır "toplam satırı" sayılıp sessizce düşüyor. Elenen satır sayısı
kullanıcıya hiçbir yerde gösterilmiyor. Bu iki kural için birim testi yok.

---

## 4. SUNUCUYA TAM GEÇİŞ

**Mevcut durum:** üç Luca ajanı çevrimiçi — biri bilgisayarda (`DEV-moxegoee-O514TN`),
ikisi sunucuda (`vps-radore-luca`, `vps-radore-luca-operator`/`moren-cekme`).

**Sunucu tarafı zaten çalışıyor:** %79 ve %96 başarı. Yani geçiş teknik olarak
mümkün, sorun yönlendirmede.

Tam geçiş için gerekenler:

1. **Bilgisayardaki ajan kapatılsın** — `DEV-` önekli cihaz iş almasın
2. **Cihaz seçici sadeleşsin** — "bu bilgisayarın ajanı" seçimi tarayıcıya bağlı;
   farklı bilgisayardan girince ya da "Otomatik"te kalınca iş hedefsiz gidiyor ve
   ölüyor (bölüm 1.2). Sabit sunucu ajanı olmalı
3. **Hedef boş kalırsa iş sıraya alınmasın** — net hata versin
   ("Luca ajanı çevrimdışı"), sessizce ölmesin
4. **Ajan `config.json`'ında `INVOICE_POST` eksik** — sunucu ajanlarında
   doğrulanmalı, yoksa Luca aktarımı o ajana hiç düşmez
5. **Çok-oturum koruması** — Luca aynı üye numarasıyla çok oturumu kilitler.
   Sunucuda iki ajan varsa ikisi aynı Luca hesabını kullanmamalı
   (`luca.service.ts:1217-1341` — bu koruma kuyrukta **hiç yok**)

---

## 5. ÖNCELİK SIRASI

| # | Bulgu | Neden önce | Bölüm |
|---|---|---|---|
| 1 | Mihsap'a çift yükleme | Mükellefin defterine çift gider — vergi hatası | 3.1 |
| 2 | İşletme fiş kesmede çift fiş | Deftere çift kayıt; koruma Bilanço'da var, burada yok | 3.7 |
| 3 | Mizan önce siliniyor | Veri geri getirilemiyor | 3.6 |
| 4 | Sonsuz tekrar-sıraya-alma | Takılmanın 1. sebebi | 1.1 |
| 5 | İş uyumsuz cihaza çivileniyor | Takılmanın 2. sebebi; sunucuya geçişle de ilgili | 1.2 |
| 6 | Kuyruk başı tıkanması | Takılmanın 3. sebebi | 1.3 |
| 7 | Aynı belge no → aynı dosya | Yanlış fatura görüntüsü, yanlış PDF | 3.2 |
| 8 | 1. sayfa dışı çekilmiyor | Sessiz eksik veri | 3.3 |
| 9 | Uyarılar ekranda görünmüyor | Eksik veri fark edilmiyor | 3.4, 3.5 |
| 10 | Hız — kör beklemeler | Günlük iş hızı 2-4 kat | 2 |

---

## 6. SAĞLAM BULUNAN YERLER

Denetimin dürüst tarafı — bunlar iyi kurulmuş:

- **İşi kapma atomik** — iki ajan aynı işi alamaz (`luca.service.ts:495-513`)
- **Kurtarma süreleri doğru sıralı** — ilerleme izleyici 150 sn, üst süre 5-15 dk;
  izleyici her zaman daha kısa
- **Belge kapma ve kısmi kapma** — çift tık ikinci iş üretmiyor, kapılamayan belge
  Excel'den çıkarılıyor
- **POSTED belge yeniden gönderilemiyor**, geri alma dürüst (fiş no saklanıyor)
- **Yükleme ucundaki eşleşme kontrolü** — iş tipi, mükellef, dönem birebir
  doğrulanıyor; ajan yanlış mükellefe dosya yükleyemiyor
- **e-Arşiv mükerrer kimliği** — ETTN önce, belge no tek başına kimlik sayılmıyor
- **Tarih aralığı** — bitiş bugünü aşmıyor, artık yıl doğru
- **Giriş koruması** — 90 sn bekleme + 3 başarısızlıkta durma, 30 dk sonra sıfırlama
- **HEADFUL varsayılanı** — frame takılmasının kökü doğru teşhis edilmiş
- **Silme güvenliği** — dönem silme dört alan + onay + yalnız ADMIN
- **CAPTCHA tavanı** — iş başına 10 dakikada en çok 8 otomatik deneme

---

## 7. AÇIK NOTLAR (doğrulanmalı)

- `apps/api/dist/agent-runtime.js` **bayat** (v1.47.41) — fiş teyidinden önceki
  davranışı taşıyor. Servis edilen yol listesinde değil, bugün zarar yok, ama
  canlıda `/agent-runtime.js` içindeki AGENT_VERSION kontrol edilmeli
- `GET /agent/luca/credential` Luca şifresini **düz metin** döndürüyor; tek koruma
  `x-agent-token` başlığı (`luca.controller.ts:449-459`)
- Aralık ayında e-Arşiv ikinci sorgusu yıl atlıyor olabilir (`agent-runtime.js:6675-6680`)
- `createdBy: req.user.id` — oturum nesnesinde `id` alanı yok (`userId` olmalı);
  e-arşiv işleri "sahipsiz" doğuyor
