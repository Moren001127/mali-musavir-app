# Portal genel denetimi — bulguların koddan doğrulanması

**Tarih:** 25 Eylül 2026
**Kaynak:** `PORTAL-GENEL-DENETIM-2026-09-25.md` (49 bulgu) + `PORTAL-DENETIM-ENVANTERI-2026-09-25.md`
**Yöntem:** 49 bulgu 7 ayrı incelemeye bölünüp güncel koddan tek tek doğrulandı. **Kod değiştirilmedi**,
canlı veriye dokunulmadı. Satır numaraları bu belgenin yazıldığı andaki kaynağa aittir.

## Karar özeti

**49 bulgunun 49'u da incelendi. Hiçbiri tamamen geçersiz çıkmadı**, ancak **7 bulgunun alt iddiası
yanlış** ya da abartılı; bunlar aşağıda tek tek düzeltildi. İki bulgu rapordakinden **daha ağır** çıktı.

| Ağırlık | Adet | Bulgular |
|---|---|---|
| Kritik (acil) | 2 | 01, 11 |
| Yüksek | 12 | 02, 10, 13, 18, 19, 21, 29, 30, 38, 39, 43, 47 |
| Orta | 25 | 03, 04, 06, 08, 12, 14, 15, 16, 17, 20, 23, 24, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 40, 41, 42, 44, 45, 48 |
| Düşük | 10 | 05, 07, 09, 22, 25, 46, 49 |

---

# 1. KRİTİK — hemen ele alınmalı

## 01. Ofis kısa adı, erişim anahtarı yerine geçiyor — **DOĞRULANDI, rapordakinden AĞIR**

**Rapor "üretim ve izin ayarı kapalıyken sahte ofisle çalıştı" diyor. Gerçek daha kötü: kapatma
düğmesi hiç işlemiyor.**

`apps/api/src/common/agent-token.ts:53-71`:

```ts
const allowLegacyLookup =
  envFlag(process.env.AGENT_TOKEN_ALLOW_TENANT_ID) || process.env.NODE_ENV !== 'production';
...
const tenant = await prisma.tenant.findFirst({          // ← KOŞULSUZ ARAMA
  where: { OR: [{ slug: presented }, { id: presented }] },
});
if (!tenant) {
  if (pairs.length > 0) throw ...;
  if (!allowLegacyLookup) throw ...;                     // ← bayrak YALNIZ BURADA
  throw ...;
}
return tenant.id;                                        // ← eşleşme varsa KOŞULSUZ DÖNÜYOR
```

`allowLegacyLookup` hesaplanıyor ama **yalnız ofis bulunamadığında** kullanılıyor. Kısa ad gerçek bir
ofisle eşleşirse bayrağa hiç bakılmadan kimlik dönüyor. Yani:

- `AGENT_TOKEN_ALLOW_TENANT_ID=false` → **etkisiz**
- `NODE_ENV=production` → **etkisiz**
- `AGENT_INGEST_TOKENS` dolu olsa bile → **etkisiz**

Tek gerçek koruma `opts.strict`. **56 çağrıdan yalnız 3'ü sıkı kipte** (`evrak-otomasyon.controller.ts:42`,
`sgk-teshis.controller.ts:25`, `taxpayer-eksik-rapor.controller.ts:33`). Kalan 53 makine ucu açık.

**En ağır sonuç** — `luca.controller.ts:437` → `luca-auto-scraper.service.ts:175`:

```ts
@Get('agent/luca/credential')
async getCredentialForAgent(@Headers('x-agent-token') agentToken: string) {
  const tenantId = await this.resolveTenantFromAgentToken(agentToken);   // strict YOK
  return this.autoScraper.getCredentialForAgent(tenantId);
}
// servis:
return { saved: true, uyeNo, username, password: decrypt(c.encryptedPassword) };
```

Tek bir `GET /api/v1/agent/luca/credential` isteği, `X-Agent-Token: <ofis-kısa-adı>` başlığıyla
**Luca kullanıcı adı ve çözülmüş parolayı** döndürüyor.

**Kısa ad gizli değil:** `auth.service.ts:189-192` ofis adını küçük harfe çevirip boşlukları tireye
dönüştürerek üretiyor. Ofis adı halka açık bilgi. `luca.controller.ts:174-184` yorumu bunu zaten
söylüyor: *"Basit: tenant.slug (resolveTenantFromAgentToken bunu kabul eder)."*

**Aynı hatanın ikinci kopyası:** `cari-kasa.controller.ts:590-611` — mantık satır satır kopyalanmış.

**Sömürülebilirlik: YÜKSEK.** Bilinmesi gereken tek şey ofis adı. Oturum, rol veya IP kısıtı yok.

**Çözüm (en küçük değişiklik, en yüksek etki):**
1. 62-71 arası kısa ad aramasını `allowLegacyLookup` bayrağının **içine** al; bayrak kapalıyken arama
   hiç yapılmasın. **Tek blok kaydırma.**
2. `pairs.length > 0` ise kısa ad yoluna hiç girilmesin.
3. Sonra tüm makine uçları `{ strict: true }`'a geçsin (kalıp projede zaten var).
4. `cari-kasa.controller.ts:590` kopyası ortak fonksiyona bağlansın.

**Derlenmiş çıktıda da aynı kusur var.** `apps/api/dist/main.js:6679-6706` kaynağın birebir derlenmiş
hâli ve `allowLegacyLookup` orada da yalnız `if (!tenant)` bloğunun içinde. İkinci kopya da derlenmiş
(`dist/main.js:133069-133074`). Tarihler: kaynak 2026-08-18, derleme 2026-09-14 — derleme kaynaktan
sonra yapılmış, yani ikisi uyumlu.

**Doğrulanamayan:** Canlıdaki `AGENT_INGEST_TOKENS` değeri ve Railway'in kendi derlemesini mi kullandığı
koddan görülemez. **Ama bulgu bu değerden bağımsız geçerli** — hem kaynak hem derlenmiş çıktı kısa adı
her hâlükârda kabul ediyor.

## 11. İşletme hesap özeti: geçici vergi İKİ KAT hesaplanıp mükellefe gönderiliyor — **DOĞRULANDI**

`apps/api/src/isletme-hesap-ozeti/isletme-hesap-ozeti.service.ts:236-246`:

```ts
const oncekiDonemler = await prisma.isletmeHesapOzeti.findMany({
  where: { tenantId, taxpayerId, yil, donem: { lt: donem } },
  select: { hesaplananGecVergi: true },                    // ← YALNIZ bu alan
});
oncekiOdenenGecVergi = oncekiDonemler.reduce(
  (acc, x) => acc + Number(x.odenecekGecVergi || 0),        // ← BAŞKA alan okunuyor
  0,
);
```

`select` yalnız `hesaplananGecVergi` getiriyor; `x.odenecekGecVergi` **undefined** → `Number(undefined || 0)`
= **0**. Bu yolda önceki dönem devri **her zaman sıfır**. Aynı hesabın doğrusu satır 468-481'de duruyor
(`select: { odenecekGecVergi: true }`) — yani `select` eski kalmış, `reduce` güncellenmiş.

**Sayı örneği (kümülatif geçici vergi):**

| | Q1 | Q2 |
|---|---|---|
| Kümülatif matrah | 100.000 | 200.000 |
| Hesaplanan %15 | 15.000 | 30.000 |
| Önceki dönem ödenen — doğru | 0 | **15.000** |
| Önceki dönem ödenen — kodda | 0 | **0** |
| Ödenecek | 15.000 | **30.000** (15.000 ₺ fazla) |

**Mükellefe gidiyor: EVET.** `buildWhatsappMesaj` (62-115) + `whatsappBilgi` (123-173, `dryRun:false`
gerçek gönderim). Mesaj birebir şunu taşıyor:

```
↪️ Önceki Dönem Ödenen Geçici Vergi: *0,00 ₺*
🏛️ Bu Dönem Ödenecek Geçici Vergi: *30.000,00 ₺*
🗓️ Ödeme Vadesi: 17 Mayıs 2026 tarihine kadar.
```

Vade de sabit (47-55) ve **17 Mayıs 2026 Pazar'a denk geliyor** (bkz. bulgu 43).

**Tetiklenme:** "Yılı Başlat" dört çeyreği birden açarsa doğru çalışıyor. Kırılan yol: Q1 dolduktan
**sonra** tek çeyrek oluşturmak (`POST /olustur`), silip yeniden açmak, ya da Q2 eksikken "Yılı Başlat"a
tekrar basmak (219: `if (existing) return existing` → Q1 atlanır).

**Çözüm:** `select`'i `{ odenecekGecVergi: true }` yap. Ek kapı: `donem > 1` iken önceki çeyrek yoksa
ya da devir 0 ise WhatsApp gönderimini durdur ("önceki dönem verisi teyit edilmedi").

**Sınama durumu:** `isletme-hesap-ozeti/` altında **hiç test yok**.

---

# 2. MÜKELLEFE GİDEN YANLIŞ BİLGİ

## 19. Mükellef cari: bağlantı hatası "Borç yok" oluyor — **DOĞRULANDI**

`apps/web/src/app/mukellef/cari/page.tsx:31-40, 98`: `isError` **hiç okunmuyor**;
`Number(data?.bakiye ?? 0)` → hata hâlinde 0 → yeşil **"Borç yok · 0,00 ₺"**.

**Daha ağırı:** "Ekstre indir" düğmesi açık kalıyor ve MOREN logolu, boş, kurumsal görünümlü bir cari
ekstre üretiyor — mükellefin "borcum yok" belgesi olarak saklayabileceği bir kâğıt.

**Yaygınlık:** `apps/web/src/app/mukellef/` altında `useQuery` kullanan 12 dosyanın **10'unda `isError`
hiç yok**. Arka uç temiz (`taxpayer-portal.service.ts:360-400` yutma yapmıyor) — kusur tamamen ön yüzde.

**Çözüm:** Hata hâlinde metrik kartlarını gösterme, hata kartı + "Yeniden dene", ekstre düğmesini
kilitle. Fatura Merkezi'nde bulgu 12 için uygulanan kalıbın aynısı.

## 43. Mali takvim: sabit gün, iş günü kaydırması yok — **DOĞRULANDI**

`apps/web/src/components/dashboard/MaliTakvim.tsx:59-83` tarihler **sabit kodlu** (`if (day === 26)`),
hafta sonu/tatil kontrolü yok.

**Hesaplanmış çakışmalar:** **26 Eylül 2026 = Cumartesi**, **28 Eylül 2026 = Pazartesi** — denetimdeki
26→28 farkının birebir açıklaması. 2026'da kayması gereken diğerleri: 25'i (KDV2) Ocak/Nisan/Temmuz/Ekim ·
26'sı Nisan/Temmuz/Eylül/Aralık · 28'i (KDV1) Şubat/Mart/Haziran/Kasım · **17 Mayıs 2026 = Pazar**
(bulgu 11'deki WhatsApp vadesi).

**Kaydırma aracı ZATEN VAR ama kullanılmıyor:** `apps/api/src/schedule/is-gunu.ts` (`ilkIsGunu`,
`SABIT_RESMI_TATILLER`, `DINI_BAYRAMLAR`). Dosyanın kendi başlığı durumu itiraf ediyor:
*"Aylık Ödeme Listesi bunu yapar, hatırlatma cron'ları yapmaz."* Tek çağıran `aylik-odeme.service.ts:261`.
Kullanmayanlar: `MaliTakvim.tsx`, `beyanname-deadline.util.ts:19-70`, `vergi-takvimi-tohum.ts`,
`taxpayer-portal.service.ts:836-837`.

**İki kural seti birbiriyle de çelişiyor:**

| Beyanname | MaliTakvim.tsx | beyanname-deadline.util.ts |
|---|---|---|
| KDV2 | ayın **25**'i | ayın **28**'i |
| Damga | ayın **26**'sı | ayın **25**'i |

Her çiftin en az biri yanlış.

**Mükellefe gidiyor: EVET, iki yoldan çelişkili olarak.** Portal uyarısı (`taxpayer-portal.service.ts:921`)
*"MUHSGK son tarihi 26.09.2026 — 1 gün kaldı"* diyor, **"tahmini" kaydı olmadan**; aynı anda ödeme
cetveli tarihi **kaydırıyor** → mükellefe cetvelde 28, portalda 26 deniyor.

**Sınama durumu — kritik:** `vergi-takvimi-tohum.spec.ts:14` **hatayı beklenen davranış olarak
sabitlemiş**: `expect(gun(...)).toBe('2026-09-26')` (Cumartesi). `is-gunu.spec.ts` ise `ilkIsGunu`'yu
**izole** sınıyor; hiçbir test onun gerçekten uygulandığını doğrulamıyor.

**Çözüm:** Tek sunucu kaynağı — `calculateBeyannameDeadline` + `ilkIsGunu` her yerde; `MaliTakvim.tsx`
sabit günlerden değil uçtan okusun; kaydırılmamış kayıt `tahmini: true` kalsın.
**Not:** `is-gunu.ts`'in kendi notu dini bayram tablosunun *"RESMÎ TAKVİMLE DOĞRULANMALI"* olduğunu
söylüyor — kaydırma aracının tatil verisi de teyitsiz. KDV2/Damga çelişkisinde hangisinin doğru olduğu
resmî takvimden okunmalı.

---

### 43-EK. GİB RESMÎ TAKVİMİNDEN DOĞRULAMA (25 Eylül 2026) — bulgu sanılandan ağır

`gib.gov.tr/vergi-takvimi` **temiz bir iş günü ayında** (Kasım 2026: 25'i Çarşamba, 26'sı Perşembe)
okundu. Çelişkili çiftlerde **hangisinin doğru olduğu kesinleşti**:

| Beyanname | MaliTakvim.tsx | deadline.util.ts | **GİB (Ekim 2026 dönemi)** | Sonuç |
|---|---|---|---|---|
| KDV2 tevkifat | 25 | 28 | **25.11.2026** | util YANLIŞ |
| Damga (her iki tür) | 26 | 25 | **26.11.2026** | util YANLIŞ |
| MUHSGK | 26 | 26 | 26.11.2026 | ikisi de doğru |
| Konaklama | 26 | 26 | 26.11.2026 | ikisi de doğru |
| KDV1 | 28 | 28 | 28.12.2026 (Kasım dönemi) | ikisi de doğru |
| Turizm payı | ay sonu | 26 | **30.09.2026** (Ağustos dönemi) | util YANLIŞ |

Ofis bu tiplerden KDV2'yi (30 kayıt) ve DAMGA'yı (1 kayıt) **gerçekten veriyor**
(`beyan_durumu` tip dağılımı, canlı okuma). Yanlış taban gün `akilli-bildirim` üzerinden
mükellefe giden "Son Ödeme" satırına da giriyordu.

**Canlı `tax_calendar` ölçümü (49 satır):** önümüzdeki 11 satırın **3'ü hafta sonuna düşüyor** —
MUHSGK 26.09.2026 · KDV1 28.11.2026 · MUHSGK 26.12.2026, üçü de **Cumartesi**.
GİB takvimi aynı yükümlülükler için **28.09 / 30.11 / 28.12** diyor. İki yıllık ufukta sapan
satır sayısı **12**.

**Daha ağır bir nokta:** `taxpayer-portal.service.ts:812` tax_calendar satırlarını
`tahmini: false` ile veriyordu. Oysa bu tabloya yazan **tek yer** tohum betiği
(`vergi-takvimi-tohum.service.ts:50`) — yani her satır bir hesap. Mükellefe hesaplanmış,
üstelik hafta sonuna düşmüş bir tarih **"kesin"** diye gösteriliyordu.

**Formülle çözülemeyen katman — sirküler uzatmaları.** Nisan 2026 döneminde Kurban Bayramı
nedeniyle GİB **199 Sıra No.lu VUK Sirküleri** ile uzatma verdi:

| | Düz iş günü hesabı | **GİB** |
|---|---|---|
| MUHSGK / Damga / Konaklama | 26.05.2026 | **03.06.2026** |
| KDV1 | 01.06.2026 | **05.06.2026** |
| KDV2 | 25.05.2026 | 25.05.2026 (uzatma yok) |
| Turizm payı | 01.06.2026 | 01.06.2026 (uzatma yok) |

Uzatma **tipe göre farklı** ve hiçbir formül üretemez. Sonuç: üretilen her tarih **tahminidir**;
bilinen uzatmalar kaynağıyla bir tabloya yazılır, bilinmeyeni uydurulmaz.

**Uygulanan düzeltme (2026-09-25):**
1. `packages/shared/src/constants/resmi-tatil.ts` — tatil tablosu + `isGununeKaydir` TEK KAYNAK.
   Tablo daha önce iki yerde kopyaydı (`apps/api/src/schedule/is-gunu.ts`,
   `packages/shared/src/constants/edefter-takvim.ts`); ikisi de artık buradan okuyor, tarayıcı da.
2. `packages/shared/src/constants/beyanname-takvim.ts` — taban günler (GİB'den doğrulananlar ✓
   işaretli, teyitsizlere dokunulmadı) + `BEYANNAME_UZATMALAR` sirküler tablosu. Kalıp e-Defter
   takviminden alındı; orada zaten doğru yapılıyordu.
3. `calculateBeyannameDeadline` artık **kaydırılmış** günü döndürüyor. Ham gün isteyen tek yer
   aylık ödeme cetveli — `beyannameHamTarihi` eklendi.
4. `EDEFTER` bu util'den kaldırıldı: oradaki "3 ay sonrasının son günü" kuralı yanlıştı
   (gerçek kural 4. ayın 10'u/14'ü, mükellef tipine bağlı). Yanlış tarih üretmektense `null`.
5. Mükellef portalı: seed satırları `tahmini: true`, uyarı metninde "(tahmini)".
6. `MaliTakvim.tsx` sabit gün kontrolünden çıktı; karar `mali-takvim-kurallar.ts` (saf, testli).

**Bayat sınamalar:** `vergi-takvimi-tohum.spec.ts:14` (2026-09-26 Cumartesi),
`aylik-odeme-donem.spec.ts:51` (DAMGA 25.08), `aylik-odeme.service.spec.ts:172,323` (DAMGA 25)
**hatayı beklenen davranış olarak çiviliyordu** — dördü de kanıt notuyla düzeltildi.
Ayrıca ilgisiz bir bayat test bulundu: `odeme-listesi-araci.spec.ts:45` dönem yazımını
`069cfb9` (2026-09-14) değiştirdiği hâlde güncellenmemişti — API paketi o tarihten beri
**2 kırmızı testle** çalışıyordu.

**Yeni sınama:** `scripts/vergi-takvimi-is-gunu-regression.cjs` (37 kontrol, zincirde).
Beklenen tarihlerin tamamı GİB takviminden alındı. Mutasyon denemesi: kayma kapatılıp
DAMGA 25'e döndürülünce **7 kontrol** düşüyor.

**Canlı veri:** kod düzelse de tohum mevcut satırlara dokunmuyor.
`scripts/vergi-takvimi-duzelt.cjs` yalnız sapan satırların `dueDate` alanını düzeltir
(silme/ekleme yok, varsayılan kuru çalışma). Kuru çalıştırıldı: **12 satır** sapıyor.

**Kalan teyitsizlik:** 2027 dini bayram tarihleri (Ramazan 9-11 Mart, Kurban 16-19 Mayıs)
hâlâ elle girilmiş — GİB 2027 takvimini henüz yayımlamadı, doğrulanamadı. 2026 tarihleri
GİB'in kendi kaydırmalarıyla tutarlı çıktı. `POSET` (24) ve `BILDIRGE` (23) GİB takviminde
görünmüyor (SGK/diğer yükümlülük) — dokunulmadı, teyitsiz işaretlendi.

## 18. Taslak KDV tutarı "resmî beyan" diye sunuluyor — **DOĞRULANDI**

`taxpayer-portal.service.ts:583-598`: tutarın koşulu (`beyan?.tahakkukTutari != null`) ile etiketin
koşulu (`beyanVar: !!beyan`) **farklı**. Satır var ama tahakkuk yoksa → tutar taslaktan gelir, ekran
*"resmî KDV beyannamenizden alınmıştır"* der (`mukellef/faturalar/page.tsx:142-145`).

**Tetikleyici ofisin kendi rutini:** `kdv-beyanname.service.ts:1964-2006` `setDevredenKdv()` — müşavir
devreden KDV'yi elle girince KDV1 satırı `durum:'beklemede'`, `tahakkukTutari` boş açılıyor.

**Rozet de ters çalışıyor:** `veriGuveni` `'beyan'` değerini üretebiliyor ama ön yüz haritasında
(`page.tsx:22-26`) yalnız `kesin|kontrol_gerekli|eksik` var → taslakta **"Veri güveni: Kesin"** yazısı
"resmî beyannamenizden alınmıştır" ile yan yana; gerçekten resmî iken rozet hiç görünmüyor.

**Çözüm:** Servis `kaynak: 'beyan' | 'taslak'` döndürsün; ekran metni `beyanVar` yerine `kaynak` ile
kurulsun; taslakta kehribar şerit: "Taslak — resmî beyan tutarı değildir."

## 31. Otomasyonda başarısız adımdan sonra mükellefe boş alanlı mesaj gidiyor — **DOĞRULANDI**

`automation-runner.service.ts:752-766` adım hatasını yutup döngüye devam ediyor; `template-resolver.ts:67`
eksik değeri **boş metne** çeviriyor.

**Somut sonuç:** "Mihsap'tan fatura çek" adımı hata verir → "WhatsApp gönder" adımı çalışır ve mükellefe
**"Sayın , döneminde faturanız işlendi"** gider. Geri alınamaz.

**Tetiklenme gerçek:** Mihsap token süresinin dolması bu projede bilinen ve sık bir durum.

**Çözüm:** Adım şemasına `onError: 'stop' | 'continue'`, varsayılan `stop`. Şablonda eksik değişken
varsa gönderimi reddet.

**UYGULANDI (2026-09-25):** İkisi birden. (1) `executeStep` hatayı artık çağırana bildiriyor;
`executeStepList` varsayılan olarak DURUYOR — akış yazarı bilerek `onError: 'continue'` demedikçe
sonraki adım çalışmıyor. (2) `eksikDegiskenler()` eklendi: `send_whatsapp_template`,
`send_whatsapp_freeform`, `send_email`, `send_sms` adımlarında şablondaki bir değişken çözülemiyorsa
(ya da boşluktan ibaretse) gönderim yapılmıyor, `[OTOMASYON-GONDERIM-ENGELI]` kaydı düşüyor.
SIFIR geçerli değer sayılıyor, eksik değil.

**DEPLOY SONRASI CANLI ÖLÇÜM — raporun örneği şu an oluşamıyor.** Sekiz aktif otomasyonun
**hiçbirinde `send_*` adımı yok**; gönderim kapısı şimdilik ÖNLEYİCİ. Adım listeleri:
`create_pending_action` · `get_taxpayer→create_pending_action` ·
`fetch_invoices_for_period→backup_to_drive` · `fetch_kdv_from_luca` ·
`generate_fis_word_from_invoices→print_word_output→create_pending_action` · `set_monthly_status` ·
`get_kdv_summary→branch_if`. Son 20 kısmi koşuda patlayan adımlar:
`generate_fis_word_from_invoices` 16, `fetch_invoices_for_period` 4.

"Dur" kuralının iki canlı akışa etkisi:
- **Fiş Word raporu** (233 koşu / 99 hata): üretim patlayınca artık boş çıktı yazdırılmıyor ve
  yanıltıcı görev açılmıyor — iyileşme.
- **Evraklar Hazır → Fatura Çek & Drive Yedekle** (249 koşu / 48 hata): çekim patlayınca Drive
  yedeği de durmuş oluyordu. Bu istenmeyen bir yan etkiydi; Muzaffer Bey'in onayıyla o tek adıma
  `onError: 'continue'` işaretlendi (`scripts/otomasyon-onerror-isaretle.cjs`, 1 otomasyon 1 adım).

Aktif otomasyonların hepsi `failurePolicy: 'notify'` — hiçbiri kendiliğinden duraklayamaz.
`failure` ve `partial` sayaç/bildirim/duraklatma yollarında aynı işlendiği için bu yönde
davranış değişmedi.

## 41(a). Kısmi mesaj teslimi "başarılı" görünüyor — **DOĞRULANDI**

`whatsapp.controller.ts:1240-1266`: bir numara tutarsa `delivered = true` → **tam başarı**; hatalar
`delivered` olduğunda siliniyor, `phoneResults` hiç dönmüyor. Ön yüz (`duyurular/page.tsx:388-391`)
yalnız `basarili`/`hatali` alıyor.

**Sonuç:** İki numaralı mükellefte patron hattına gitmez, muhasebe hattına gider → ekran "gönderildi" der.
İz tamamen kaybolmuyor (her numara için ayrı `communicationLog` satırı yazılıyor) ama görmek için
sohbeti tek tek açmak gerekiyor.

**UYGULANDI (2026-09-25):** Yanıt `kismiTeslim` sayacı, satır başına `kismi` bayrağı ve
`numaraSonuclari` (numara + sonuç + hata) taşıyor; kısmi teslimde `error` alanı artık SİLİNMİYOR.
Duyurular ekranı kısmi teslimde yeşil "başarılı" yerine uyarı gösteriyor:
*"N mükellefte BAZI numaralara ulaşmadı"*.

---

# 3. VERİ KAYBI

**Genel tespit:** Şemada `deletedAt` **hiç yok** — bütün silmeler kalıcı. Denetim günlüğü kurtarma
sağlamıyor (`audit.interceptor.ts` `resourceId`/`oldData`/`newData` alanlarını **boş bırakıyor**, GET
isteklerini hiç kaydetmiyor, hatayı `.catch(() => {})` ile yutuyor). Drive yedeği yalnız Mihsap fatura
**dosyalarını** kapsıyor.

## 38. Mihsap yenileme: veriyi çekmeden eski dönemi siliyor — **DOĞRULANDI, en ağır veri kaybı**

`mihsap.service.ts:741-762`: `clearPeriod` (silme) uzak çağrıdan **önce**; `listAllInvoices` sonra.
Hata yakalanıyor ama silinen geri gelmiyor. Üç kat genişleme:

1. **Sıra:** oturum/token düşmüşse dönem boşalır.
2. **Yön karışması:** silme `faturaTuru` süzmüyor → "alış" yenilemesi **satış kayıtlarını da siliyor**,
   geri çekim yalnız alış yapıyor.
3. **Kaynak karışması:** `kaynak` süzmüyor → arşiv yenilemesi "bekleyen" kayıtları siliyor.

**Ön yüz durumu gizliyor:** `faturalar/page.tsx:364` `isRetriableMihsapError` token/oturum hatalarını
hata saymıyor, *"Mihsap oturumu tazelenince otomatik tamamlanacak"* diyor — veri silinmişken kullanıcı
sorun olmadığını sanıyor. Toplu kip (`handleFetchAll`, 327-386) bunu **bütün mükellefler için** yapıyor.

**Geri alınabilirlik:** `bekleyen` kaynaklı kayıtlar ve `mihsapFileLink` boş olanlar Drive'da **yok** →
tamamen kayıp. DB üstverisi hiçbir durumda geri gelmez.

**Çözüm:** Silmeyi çekim başarıyla bittikten sonraya al, tek `$transaction`. `clearPeriod`'a `faturaTuru`
ve `kaynak` ekle. Daha güvenlisi: hiç silme — `mihsapId` zaten `@unique`, `upsert` üzerine yazar.

**UYGULANDI (2026-09-25):** Silme artık çekimden SONRA ve yalnız çekim sorunsuz bittiyse.
`clearPeriod`'a üç süzgeç eklendi: `faturaTuru` (TEVKIFATLI_ALIS da alış sayılır), `kaynak`,
ve `koruId` — bu çekimde görülen `mihsapId`'ler korunur, yalnız Mihsap'ta artık bulunmayan
eski satırlar temizlenir. Çekim patlarsa kayıt silinmez, kayda `[MIHSAP-YENILE] ... HİÇBİR
KAYIT SİLİNMEDİ` düşer. Süzgeçsiz çağrı eski davranışı koruyor (başka çağıran kırılmasın).


## 10. Mizan: kilitli mizan uyarısız siliniyor — **DOĞRULANDI (rapordaki ifade kısmen yanlış)**

- **10a:** `mizan.service.ts:398-411` `importFromExcel` **kilit kontrolü yapmıyor**. `deleteMizan` (1329),
  `lockMizan` (1339), `importFromLuca` (302) yapıyor. Bu yol hem `POST /mizan/upload` hem tarayıcı
  eklentisinin normal mizan yolu (`luca.controller.ts:854`).
- **10b:** `importFromLuca:307-325` önce siliyor, sonra Luca'ya bağlanıyor → çekim başarısızsa eski mizan
  gitmiş olur.
- **10c:** İşlem (transaction) yok.

**Raporun düzeltmesi:** "kilit denetimi olmadan siliyor" ifadesi `importFromLuca` için **geçerli değil**
(kilit kontrolü var); onun sorunu silme **sırası**.

**Etki:** `Mizan` silinince `MizanHesap` + `MizanAnomali` cascade gidiyor (300-2000 satır).
`rawExcelKey` alanı şemada var ama `importFromExcel` **doldurmuyor** — orijinal Excel bile saklanmıyor.

**CANLI ÖLÇÜM (2026-09-25):** 203 mizanın **58'i kilitli** ("kesin kayıtlı"), toplam 35.266 hesap satırı.
En yeni kilitliler 2026-Q1/Q2 geçici vergi dönemleri, 50–365 hesap arası. `rawExcelKey` alanı şemada
var ama HİÇBİR yol doldurmuyor — orijinal Excel saklanmıyor, silinen mizan geri getirilemez.

**DURUM: UYGULANMADI — Mizan KİLİTLİ MODÜL.** Önerilen yama `MIZAN-BULGU10-ONERILEN-YAMA.patch`
dosyasında; onay bekliyor.


## 21. Okuma işlemleri kalıcı değişiklik yapıyor — **DOĞRULANDI (iki kardeş)**

Fatura Merkezi'nde `aeb14fb` ile kapatılan desenin aynısı, iki yerde daha:

- **21a — Excel'e aktarmak vergi tutarını değiştiriyor.** `isletme-hesap-ozeti.service.ts:283-320`
  `getYil()` içinde `updateManuel` çağrılıyor; o da (426-431) geçici vergiyi **yeniden hesaplayıp
  kaydediyor**. Yazma yapan okuma uçları: `GET /yil/:taxpayerId/:yil` ve `GET /export/:taxpayerId/:yil`.
- **21b — Beyan listesi açmak kayıt siliyor.** `beyan-kayitlari.service.ts:1004-1012` `list()` içinde
  `void repairTemporaryTaxDuplicates(...)` → `deleteMany`. Ateşle-unut, kullanıcıya bildirim yok,
  denetim günlüğüne girmiyor (GET kaydedilmiyor).

**Çözüm:** 21a'da yayılımı bellekte yap (Fatura Merkezi'ndeki `maskLinesByPlanForRead` kalıbı); kalıcı
yazma isteniyorsa ayrı bir POST ucu olsun. 21b'de onarımı listeden çıkar, planlı işe taşı; silme yerine
işaretle.

**UYGULANDI (2026-09-25):**
- **21a** — `getYil()` artık YAZMIYOR. Zarar yayılımı bellekte yapılıyor (`zararYayilmisGorunum`);
  türetilen alanlar `updateManuel` ile birebir aynı formülle yeniden hesaplanıyor, kayıt
  `zararYayilmisGorunum: true` ile işaretleniyor. Kalıcı yayılım zaten `updateManuel` içinde
  vardı (2026-08-06) — kullanıcı herhangi bir çeyreği kaydedince değer yerine oturuyor.
  Kilitli çeyreğe hiç dokunulmuyor.
- **21b** — `list()` artık onarım tetiklemiyor. Onarım iki yoldan çalışıyor: gece 03:20 planlı iş
  (`gecelikMukerrerOnarimi`, `GECICI_VERGI_ONARIM=off` ile kapatılır) ve
  `POST /beyan-kayitlari/gecici-vergi-onarim` (yönetici+personel). İkisi de kaç satır silindiğini
  döndürüyor ve `[GECICI-ONARIM]` kaydı düşüyor — eskiden sessizdi.


## 39. e-Defter yeniden analizi kullanıcı kararlarını siliyor — **DOĞRULANDI**

`edefter-control.service.ts:600-620` `reanalyzeSession` tüm `eDefterFinding` kayıtlarını silip yeniden
üretiyor. Silinen: `status` (`RESOLVED`/`IGNORED`) ve `detail.note` (1000 karaktere kadar kullanıcı notu),
`resolvedAt`, `resolvedBy`.

**En kritik yanı:** Mizan sonradan gelince sistem **kendiliğinden** yeniden analiz çalıştırıyor
(`luca.controller.ts:869-880`) — kullanıcı hiçbir şey yapmadan tüm kararları silinebiliyor. Tekrar
üretilemeyen insan emeği.

**Olumlu:** İşlem `$transaction` içinde; kaynak Excel `session.rawExcelBytes`'ta saklı.

**Çözüm:** Bulgulara kalıcı eşleşme anahtarı (`hash(category+voucherKey+rowIndex+hesapKodu+message)`),
yeniden analizde karar+notu geri yaz.

**RAPORUN DÜZELTMESİ (2026-09-25):** *"Mizan sonradan gelince sistem kendiliğinden yeniden analiz
çalıştırıyor — kullanıcı hiçbir şey yapmadan tüm kararları silinebiliyor"* iddiası **GEÇERSİZ**.
`luca.controller.ts:905-921` tam bunun için yazılmış: `status != 'OPEN'` bulgu sayılıyor, varsa
otomatik tazeleme YAPILMIYOR ve iş günlüğüne *"işaretler silinmesin diye ... YAPILMADI"* yazılıyor.
Gerçek risk yalnız elle basılan **"Yeniden Analiz"** düğmesiydi.

**UYGULANDI (2026-09-25):** Kalıcı eşleşme anahtarı (`bulguAnahtari` = ağırlık|kategori|fiş|satır|
hesap|mesaj) ile `status`, `note`, `resolvedAt`, `resolvedBy` yeniden analizden sonra geri yazılıyor
(aynı `$transaction` içinde, yarım kalmasın). Geri yazılamayan karar sayısı `[EDEFTER-YENIDEN-ANALIZ]`
kaydına düşüyor (o bulgu yeni analizde artık çıkmıyor demektir). `message` anahtara dahil: aynı
hesapta farklı tutarla çıkan iki uyarı ayrı bulgudur, kararları birbirine geçmez.


## 24. Fiş arşivi: yeni çıktı eski geçmişi siliyor — **DOĞRULANDI**

`fis-yazdirma.service.ts:858-880`: üç kusur — (1) silme anahtarı kimlik değil **serbest metin
`mukellefName`** (şemada `mukellefId` var ama kullanılmıyor), (2) `deleteMany` `create`'ten önce,
transaction yok, (3) `printStatus` süzülmüyor → `REQUESTED`/`PRINTING` kuyruktaki iş de siliniyor.

**En düşük kalıcı zarar** (Word belgesi kaynak fişlerden yeniden üretilebilir) ama yazdırma kuyruğunu
silmesi ayrıca düzeltilmeli.

## 15, 16, 17 — KDV Kontrol (KİLİTLİ MODÜL)

- **15 — DOĞRULANDI.** `kdv-control.service.ts:3413-3423` `deleteImage` kilit kontrolü yapmıyor; oysa
  `assertSessionUnlocked` aynı dosyada **22 yerde** çağrılıyor ve hemen 14 satır altındaki
  `runReconciliation` (3427) yapıyor. Kilitli kontrolün dayanak görseli tek istekte siliniyor.
  S3 nesnesi kalıyor (kod yorumu: "S3'ten silme şimdilik devre dışı") → kısmen kurtarılabilir.
- **16 — DOĞRULANDI.** `unlockSession` (6155-6161) `taxpayerMonthlyStatus`'a dokunmuyor. Kod tabanında
  **`kdvKontrolEdildi: false` yazan tek bir yer yok**. Veri kaybı değil, yanlış durum; elle düzeltilebilir.
- **17 — DOĞRULANDI.** `uploadImageBuffer` (1444-1460) depolama hatasını yutuyor, kayıt yine oluşuyor →
  **hayalet kayıt**: tutar hesaba girer, görsel yoktur. Karşılaştırma: `confirmImageUpload` (1478-1483)
  doğru davranıp `getObjectMeta` ile doğruluyor.

---

# 4. ÇİFT İŞLEM VE GERÇEĞİ YANSITMAYAN BAŞARI

## 30. Belgeler saklanamasa bile "Tamam" deniyor — **DOĞRULANDI**

`portal-automation.service.ts:1737-1834`: depolama hatası `saveErrors`e düşüyor, iş yine `done`.
Asıl kusur satır 1805:

```ts
const finalCount = Number.isFinite(Number(input?.recordCount))
  ? Number(input.recordCount)     // ← İSTEMCİNİN bildirdiği sayı ESAS
  : recordCount;                  // ← gerçekten saklanan sayı
```

**Sonuç:** Depo erişilemezken 40 e-Tebligat indirilir, hiçbiri saklanamaz, ekran **"40 kayıt portala
yazıldı"** der. Tebligat bildirimi de üretilmez (`storageKey: { not: null }` şartı, 1846) → kullanıcı
ne belgeyi görür ne uyarıyı alır. Gece işi olduğu için kimse fark etmez.

**Bu, Fatura Merkezi'nde `aeb14fb` ile kapatılan 14(a) bulgusunun birebir aynısı.** Çözüm kalıbı hazır:
`luca.service.ts:552-568`'deki "teyit edilemedi" deseni.

**UYGULANDI (2026-09-25):** `recordCount` artık GERÇEKTEN saklanandan. Ajanın bildirdiği sayı ile
yazılan sayı farklıysa fark `saveErrors`'a ve `[TEYIT-EDILEMEDI]` kaydına düşüyor. Ajan kayıt bildirip
hiçbiri saklanamadıysa iş `done` değil **`failed`**; ekran metni *"PORTALA HICBIRI YAZILAMADI — teyit
edilemedi"* diyor. Kısmi başarı (bazısı yazıldı) `done` kalıyor, gerçek sayıyla.
`failed` işlerde otomatik yeniden deneme YOK (kontrol edildi: 4 yer yalnız raporlama için sayıyor).

## 29. Sağlıklı uzun işler "başarısız" sayılıyor — **DOĞRULANDI**

`automation-runner.service.ts`: `MAX_WAIT_MS = 1 saat` (26) ama `STALE_RUNNING_MS = 2 dakika` (32);
watchdog her dakika `startedAt < now-2dk` olan çalışmaları `failure` yapıyor (259) — **kalp atışı/sahip
kontrolü yok**. İş bitince aynı satır kendi sonucuyla eziliyor ve `totalRuns` **ikinci kez** artıyor.

**Sonuç:** 2 dakikayı aşan her çalışma (bekleme adımı, 200 mükellefli döngü, uzun AI adımı) kullanıcıya
"sunucu yeniden başlatıldı" yalanı söylüyor; sayaçlar bozuluyor; `failurePolicy: 'pause_after_3'`
yüzünden **sağlıklı otomasyon kendiliğinden duraklayabiliyor**.

**UYGULANDI (2026-09-25):** İki kapı eklendi. (1) Eşik `MAX_WAIT_MS + 5 dk`ya bağlandı (2 dakika değil).
(2) `this.running` ile BU süreçte hâlâ çalışan otomasyonlar hiç dokunulmadan atlanıyor; kayda
*"bu süreçte HÂLÂ SÜRÜYOR — dokunulmadı"* düşüyor. Açılıştaki ilk çağrı `running` boşken yapıldığı için
gerçek çökme artıkları yine temizleniyor. Hata metni de artık kesin konuşmuyor.

## 27. Aynı onay iki kez yürütülebiliyor — **DOĞRULANDI**

`ekip-onay.service.ts:165-213`: `findFirst` (okuma) → durum kapısı → `yurut()` (**dış gönderim**) →
`update`. Kapma (`updateMany` + koşullu `where`) yok, transaction yok. Kapı ile yazma arasındaki boşluk
dış gönderimin tamamı kadar uzun. İkinci yol: `tool-executor.service.ts:3188-3249`.

**Sonuç:** Mükellefe **iki kez aynı WhatsApp mesajı**; ya da gönderim başarılı olup yazma hata alırsa
kayıt PENDING kalır, kullanıcı tekrar basar.

**UYGULANDI (2026-09-25):** Her iki yolda da koşullu `updateMany` ile KAPMA. `ekip-onay.service.ts`
kaydı önce `EXECUTING`e çekiyor; ikinci çağrı 0 satır güncelleyip *"şu anda yürütülüyor ya da daha önce
yürütüldü"* diyor. Gönderim patlarsa `PENDING`e geri bırakılıyor (kullanıcı yeniden deneyebilsin).
`tool-executor.service.ts` yolunda onay önce EXECUTED'a çekiliyor, komut sonra yaratılıyor; komut
yazılamazsa onay geri bırakılıyor.

## 28. İki ajan aynı işi alabiliyor — **DOĞRULANDI (etki koşullu)**

`portal-automation.service.ts:1642-1667`: `findFirst({ status: 'pending' })` → `update({ where: { id } })`
— **update'in where'inde durum koşulu yok**. `pendingJobsForAgent` (1321) `targetDeviceId: null` işleri
her cihaza gösteriyor.

**Koşul:** Bu repoda `markRunning` ucunu çağıran istemci **bulunamadı** (panel yalnız `cancel` çağırıyor,
yerel ajan `/agent/luca/jobs/pending` kullanıyor). Sunucu koşucusu `this.busy` bayrağıyla korunuyor ama
bu **tek süreç içindir** — Railway kopya sayısı 1'den büyükse koruma yok. Kodun yarışa açık olduğu kesin;
canlı etki için kopya sayısı teyit edilmeli.

**Aynı desenin kardeşi — raporda yoktu, doğrulama sırasında bulundu:**
`portal-automation.service.ts:1579-1590` `cancelJob` de oku-sonra-yaz kalıbında ve **panelden gerçekten
çağrılıyor** (`apps/web/src/lib/portal-automation.ts:302`):

```ts
findFirst({ where: { id: jobId, tenantId } });
if (['done','failed','cancelled'].includes(job.status)) return job;   // kapı
update({ where: { id: jobId }, data: { status: 'cancelled', ... } });  // durum koşulu YOK
```

**UYGULANDI (2026-09-25):** `markRunning` koşullu `updateMany` ile kapıyor — ikinci ajan 404 alıp başka
işe geçiyor, `attempts` bir kez artıyor. `cancelJob` yalnız `done/failed/cancelled` DIŞINDAKİ işleri
iptal ediyor; iş bu arada bittiyse güncel kayıt aynen dönüyor.

Kullanıcı "İptal"e bastığı anda koşucu `completeJob` çağırırsa iş `cancelled` yazılıp sonuçlar kaybolmuş
görünebilir, ya da tersi olur. Çözüm aynı: koşullu `updateMany` + `count === 0` ise "iş zaten kapanmış".

---

# 5. SAHİPLİK VE KÜTLE ATAMA

## Ortak kök: "izinli alan listesi" var sanılıyor, yok

`main.ts:113-118` `whitelist: true, forbidNonWhitelisted: true` **açık** — ama NestJS, gövde tipi `any`
olduğunda bu süzgeci **tamamen atlar**. Sayım:

- 343 `@Body()` parametresinden **106'sı `any`**, yalnız **13'ü** tanımlı sınıf kullanıyor.
- Zod ile doğrulayan controller'lar var (`taxpayers.controller.ts:139` `UpdateTaxpayerSchema.safeParse`)
  → **o uçlar güvenli**. Ama `butce`, `cari-kasa`, `banka-takip`, `message-templates`,
  `edefter-control`, `ekip` controller'larında Zod doğrulaması **yok**.
- Gövdeyi doğrudan yazan `update({ where: { id }, data })` kalıbı **15 serviste** bulundu.

## 13. Banka/HGS: korunması gereken alanlar değiştirilebilir — **DOĞRULANDI (ofis sınırını aşan tek bulgu)**

`banka-takip.service.ts:73-92`:
```ts
const mevcut = await prisma.bankaHesap.findFirst({ where: { id, tenantId } });   // "başlangıçta benim mi"
if (!mevcut) throw new NotFoundException(...);
return prisma.bankaHesap.update({ where: { id }, data });                        // gövdenin TAMAMI
```
`PUT /banka-takip/hesaplar/:id` gövdesine `{"tenantId": "<başka ofis>"}` konursa hesap **başka ofise
taşınıyor**; `{"taxpayerId": ...}` konursa hesap ve geçmişi başka mükellefe kayıyor.

HGS (`galeri.service.ts:56-99`) kütle atama yapmıyor ama `taxpayerId`'yi doğrulamadan yazıyor;
`Arac.taxpayerId` şemada yabancı anahtar bile değil.

## 12. Cari kasa: mükellef ve hizmet sahipliği doğrulanmıyor — **DOĞRULANDI**

`cari-kasa.service.ts:437` `createTahsilat` hesabı titizce doğruluyor, **mükellefi hiç doğrulamıyor**.
`createManuelTahakkuk` (487) ne `taxpayerId` ne `hizmetId` doğruluyor. Sonuç: A ofisinin `tenantId`'siyle
B ofisinin mükellefine bağlı kayıt; `listHareketler` `include: { taxpayer: {...} }` ile döndüğü için
**A ofisi ekranında B ofisinin mükellef unvanı ve vergi numarası görünüyor**.

Doğru kalıp `banka-takip.service.ts:49-56`'da zaten var.

**UYGULANDI (2026-09-25):** Ortak `mukellefiDogrula()` eklendi; `createTahsilat` ve
`createManuelTahakkuk` çağırıyor. Manuel tahakkukta ayrıca HİZMET doğrulanıyor: hizmet bu ofise
ait olmalı ve `hizmet.taxpayerId` doluysa seçilen mükellefle aynı olmalı (ofis içi karışma).

## 14. Ekstre başka mükellefin hesabına bağlanabiliyor — **DOĞRULANDI**

`banka-takip.service.ts:119-140`: iki kontrol de doğru ama **aralarındaki bağ kurulmuyor** —
`bankaHesap.findFirst({ where: { id, tenantId } })` içinde `taxpayerId` yok. Ofis içi mükellef karışması.
**Tek satırlık düzeltme:** `where: { id, tenantId, taxpayerId: data.taxpayerId }`.

**UYGULANDI** — Faz A turunda kapatılmıştı (`banka-takip.service.ts:153-158`).

## 23. Fiş yazdırma: başka ofisin çıktı durumu değiştirilebiliyor — **DOĞRULANDI**

`fis-yazdirma.service.ts:961-975` `completePrint` `tenantId`'yi parametre alıyor ama **gövdede hiç
kullanmıyor**. Aynı dosyada üç doğru örnek var (`claimPrint` 945, `getOutput`, `setOutputPrinted`).
Veri okunmuyor, yalnız durum bozuluyor.

**UYGULANDI (2026-09-25):** `update` → koşullu `updateMany({ where: { id, tenantId } })`; eşleşme
yoksa `[OFIS-KORUMA]` kaydı + 404. Yabancı ofis artık durumu değiştiremiyor.

## 03. KDV kontrol: yabancı belge bağlanabiliyor — **DOĞRULANDI (rapordaki "Yüksek" abartılı, gerçekçisi Orta)**

`kdv-control.service.ts:1471-1496` `confirmImageUpload` nesne anahtarının ofis bağını doğrulamıyor,
yalnız varlığına bakıyor. **Yol geçişi yok** (anahtar dosya yolu değil). Anahtarların çoğunda
`randomUUID()` var → tahmin edilemez. **İstisna e-Arşiv:** `earsiv.service.ts:84-107` tamamen kurala
bağlı (`${tenantId}/earsiv/${taxpayerId}/${donem}/${yon}-${kaynak}/${faturaNo}.pdf`), rastgelelik yok.

Sömürü için portalda geçerli hesap **ve** hedef anahtarın önceden bilinmesi gerekiyor.

**Ucuz ara çözüm:** Onayda `dto.s3Key`'in `${tenantId}/` ile başladığını denetle.

**DURUM: UYGULANMADI — KDV Kontrol KİLİTLİ MODÜL.** Canlı ölçüm (salt okuma): `receipt_images`
tablosunda **15.168 kayıt var ve TAMAMI `mihsap://<id>` biçiminde** — tek bir S3 yollu anahtar yok.
Bu kayıtlar `confirmImageUpload`'dan GEÇMİYOR (o uç gerçek S3 `HeadObject` yapıyor, `mihsap://`
anahtarı orada null döner). Yani elle yükleme yolu canlıda hiç kullanılmamış.

Önerinin doğruluğu anahtarı ÜRETEN yoldan teyit edildi: `kdv-control.service.ts:1415` →
`storage.getPresignedUploadUrl(tenantId, sessionId, …)` → `storage.service.ts:48`
`${tenantId}/${taxpayerId}/${uuid}.${ext}` (buradaki "taxpayerId" argümanı aslında sessionId).
Yani bu uç için issue edilen anahtar `${tenantId}/${sessionId}/…` — öneri geçerli ve oturuma da
bağlanabilir. **UYGULANDI (2026-09-25, Muzaffer Bey onayıyla — kilitli modül):** Kapı hem ofise hem OTURUMA
bağlandı: `s3Key` `${tenantId}/${sessionId}/` ile başlamıyorsa `[OFIS-KORUMA]` kaydı + red.
Denetimin önerisinden sıkı; presign'ın zaten ürettiği biçim olduğu için mevcut akış etkilenmiyor.
Gerekçe ve risk değerlendirmesi `KDV-BULGU03-ONERILEN-YAMA.patch` dosyasında.

## 47. Genel sorgulamalarda eksik fatura gizleniyor — **DOĞRULANDI**

`genel-sorgular.service.ts:194-209`: satıcı VKN anahtara katılmış **ama yanına koşulsuz bir
numara-only yedek anahtar da ekleniyor**:

```ts
const anahtarlar = [`${taxpayerId}::${faturaNo}::${vkn}`, `${taxpayerId}::${faturaNo}::`];
...
const varMi = kayitli.has(tam) || kayitli.has(kisa);
```

Yedek anahtar **her kayıt için** ekleniyor ve sorgu tarafı **her zaman** ona bakıyor → **satıcı VKN'si
eşleştirmede hiçbir işe yaramıyor.** Dosyanın kendi açıklaması (141) "VKN yoksa yalnız faturaNo" diyor,
kod "VKN olsa da" düşüyor.

**Bu, Fatura Merkezi'nde `3bdf1ed` ile çözülen bulgunun birebir kardeşi.** Canlı ölçümde aynı mükellefte
aynı numaranın 3-5 ayrı satıcıda çıktığı biliniyor. Fark: orada fatura siliniyordu, burada **eksik fatura
gizleniyor** — ikisi de sessiz.

**UYGULANDI (2026-09-25):** Yedek anahtar artık YALNIZ Luca kaydında satıcı VKN'si yoksa devreye
giriyor. VKN varsa tam anahtar aranıyor.

**CANLI ÖLÇÜM:** 2.470 ALIŞ kaydının **609'unda satıcı VKN'si boş** (yedek anahtar onlar için
çalışmaya devam ediyor). Çakışma gerçek: aynı mükellefte aynı fatura numarasının farklı satıcıda
çıktığı **10 grup** var; `GIB2026000000161` **3 ayrı satıcıda**.

**DÜZELTME ÖNCESİ/SONRASI CANLI KARŞILAŞTIRMA:** Gerçek `eksikGorseller()` iki kodla da çalıştırıldı —
sonuç **birebir aynı** (23 LUCA_YOK satırı). Bugünkü DVD verisinde çakışan numaralar zaten Luca'da
hiç yok, o yüzden fark oluşmuyor. Yani düzeltme **bugün bir şey değiştirmiyor**; çakışma denk
geldiğinde eksik faturanın gizlenmesini önlüyor. Yanlış alarm patlaması da YOK.

---

# 6. KİMLİK VE OTURUM

## 02. Luca: iş kimliği üzerinden başka ofise erişim — **DOĞRULANDI**

`luca.controller.ts`'de beş uçta anahtar doğrulanıyor ama **dönen ofis kimliği atılıyor**
(`await this.resolve...` — sol tarafta değişken yok): 639 (`jobs/:id/done`), 679 (`fail`),
696 (`invoice-excel`), 730 (`account-csv`), 749/753 (`account-plan-synced`).

Servis tarafı da açık: `luca.service.ts:562` ve `885` `updateMany({ where: { id: jobId, ... } })` —
`tenantId` yok. Doğru kalıp aynı dosyada var (`1141` `requeueJobForAgent`).

**Etki:** Başka ofisin iş kimliğini bilen biri fatura Excel'ini ve hesap planı CSV'sini indirir, işleri
"bitti" işaretler. İş kimliği `cuid` olduğu için kaba kuvvetle bulunamaz — **ama bulgu 01 ile birleşince
kolay:** kısa adla o ofis adına kimlik doğrulanır, iş listesi meşru yoldan alınır.

## 08. Drive: rol denetimi yok — **DOĞRULANDI** / kullanıcı oluşturma rolü — **GEÇERLİ DEĞİL**

- **Drive doğrulandı:** `drive.controller.ts`'de `RolesGuard` ve `@Roles` **hiç geçmiyor**; sınıfta
  `@SkipThrottle()` de var (istek sınırı yok). `disconnect` (75-79) bağlantıyı siliyor,
  `bekleyen-yedek-temizle` (100-111) Drive dosyalarını çöpe taşıyor. **READONLY bir hesap bile
  yedekleme düzenini bozabiliyor.** Ofisle daraltılmış, yani ofisler arası sızma yok.
- **Kullanıcı oluşturma rolü geçersiz:** `users.controller.ts:8` sınıf düzeyinde `RolesGuard`, `:25`
  `@Roles('ADMIN')` **var**.
- **Alan doğrulaması doğrulandı:** `@Body() dto: any` → süzgeç atlanıyor; `users.service.ts:55-78`
  parola uzunluğu ve e-posta biçimi denetlemiyor ve **`role.upsert` gönderilen herhangi bir rol adını
  yaratıyor** — "ADMİN" gibi bir yazım hatası sessizce yetkisiz bir rol üretir.

**Not:** `RolesGuard` + `@Roles` projede **18 controller'da** var (rapor "25+" demiş, fazla).

## 06. Parola değişince eski oturum — **KISMEN: müşavir tarafı kapalı, mükellef portalı açık**

- **Müşavir:** Oturum açıkken parola değiştirme ucu **yok**; tek yol e-posta bağlantısı ve
  `auth.service.ts:80` **tüm yenileme anahtarlarını siliyor**. Açık kalan tek şey eldeki erişim anahtarı,
  süresi **15 dakika**.
- **Mükellef portalı:** `taxpayer-portal.service.ts:777-788` ve `128-142` **hiçbir oturumu iptal
  etmiyor**; anahtar süresi **12 saat**, iptal listesi yok. Parola değiştirilse bile çalınmış anahtar
  12 saat geçerli.
- Mevcut kapatma düğmesi: `portalEnabled`/`isActive` — müşavir portal erişimini kapatırsa anahtar
  anında ölüyor.

## 04. Parola özetleri tarayıcıya gidiyor — **DOĞRULANDI (bir alt iddia yanlış)**

- `taxpayers.service.ts:335-356` `findOne` **`select` kullanmıyor** → `portalPasswordHash` yanıta
  giriyor. Uç `taxpayers.controller.ts:82`, **rol şartı yok**.
- `users.service.ts:107-111` `deactivate` tüm modeli döndürüyor: `passwordHash` **ve** `totpSecret`.
- **Yanlış olan:** giriş yanıtında parola özeti **yok** — `sanitizeUser` temizliyor. Ama `totpSecret`,
  `failedLoginCount`, `lockedUntil` kalıyor.
- Doğru kalıp aynı serviste var: `findAll` (233-287) açık `select` kullanıyor.
- Yanıt temizleyen ara katman projede **yok** (`ClassSerializerInterceptor` kurulmamış).

## 09. Aynı e-posta farklı ofislerde — **DOĞRULANDI (bir kaynak yanlış)**

`User` için `@@unique([tenantId, email])` — e-posta tek başına benzersiz değil. `Taxpayer.portalEmail`
için **hiçbir tekillik kısıtı yok**, aynı ofiste bile. Giriş `findFirst` ile **ilk bulduğunu** alıyor.
**Raporun verdiği `:219` satırı yanlış** (orası `setPortalAccess`, ofisle daraltılmış); doğrusu `:103`.

Kimlik doğrulama atlatması **değil** — parola yine tutmalı. Hesap karışıklığı ve erişim engeli.

## 07. İkinci adım kilide katılmıyor — **DOĞRULANDI ama düşük**

Doğru paroladan sonra sayaç **sıfırlanıyor**; 2FA hatası ayrı yerde ve sayacı artırmıyor. Kaba hesap:
1.000.000 kodun 3'ü geçerli, dakikada 100 deneme → beklenen süre **günlerce**, üstelik parolanın önceden
bilinmesi şart. Asıl eksik kilit değil, **alarm ve tekrar kullanım denetimi**.

## 05. Hesap değişiminde eski veri — **DOĞRULANDI ama ekran sorunu, sunucu doğru**

`providers.tsx:10` `staleTime: 60s`; `mukellef/layout.tsx:65-68` `logout()` belleği temizlemiyor; mükellef
sorgu adları kimliksiz (`['portal-cari']`). **Sunucu doğru veriyi dönüyor** — sorun yalnız ekranda kalan
eski veri. Müşavir tarafı doğru yapıyor (`useAuth.ts:38` `queryClient.clear()`).

---

# 7. GÖRÜNÜRLÜK VE EKSİK GÖSTERİM

| # | Karar | Kanıt ve etki |
|---|---|---|
| 44 | DOĞRULANDI | `panel/page.tsx` 837-882 arası yedi sorgu hatayı sıfıra çeviriyor; `queueUnavailable` bayrağı üretiliyor ama **hiçbir yerde okunmuyor**. `KritikUyariStatCard.tsx:49` catch yok → API düşünce **"Sorun yok"**. |
| 42 | DOĞRULANDI | `galeri.service.ts:454-473` son kaydı alıyor, **`durum` alanına bakmıyor**; `kaydetSorguSonucu` hatalı sorguya da `ihlalSayisi: 0` yazıyor → tek başarısız sorgu önceki ihlalleri panodan siliyor. |
| 45 | DOĞRULANDI | `taxpayers.service.ts:966` `EVRAK_BEKLIYOR` aşamasını **tamamen dışarıda bırakıyor** + `.slice(0,10)`; ekran süzgeçleri o 10 kayıt üzerinde. **208 gündür evrak bekleyen mükellef "Geç Kalanlar"da asla çıkmıyor.** |
| 35 | DOĞRULANDI | `documents:250` take 100, `tasks:464` 500, `office-chat:115` 80, `taxpayer-portal:409` 300 — sayfalama/toplam/uyarı yok. `taxpayer-portal:409` süzgeci **bellekte** uyguluyor → otomatik inen belgeler kotayı doldurunca mükellefin dosyaları görünmüyor. |
| 48 | DOĞRULANDI | `genel-sorgular.service.ts:126` `take: 4000` sonra grup seçimi **bellekte** → sık sorgulanan mükellefler tavanı doldurunca seyrek sorgulananın güncel durumu hiç çıkmıyor. |
| 32 | DOĞRULANDI | Okundu bilgisi bildirim satırında **tek alan** (`isRead`), kullanıcı bazlı tablo yok → ofis geneli bildirimi biri açınca **herkes için** okundu oluyor. Ayrıca `taxpayer-portal.service.ts:689-692` `viewedAt`'i bağlantı üretilmeden **önce** yazıyor. |
| 33 | DOĞRULANDI | `system-health.service.ts` sorgularında `tenantId` **yok** (105, 152, 192, 83, 517) → başka ofisin ajanı bizim panelde "sağlıklı" görünüyor. Satış hazırlığı için en riskli olanı. |
| 34 | DOĞRULANDI | `tasks.service.ts:527` gecikmiş sayacı `SNOOZED`'ı dışlıyor ve `snoozedUntil`'e bakmıyor; repoda **`SNOOZED → OPEN` geri dönüşü yapan hiçbir iş yok** → ertelemesi biten görev kalıcı kayboluyor. |
| 36 | DOĞRULANDI | `DocumentVersion` şemasında `mimeType`/özgün ad **yok**; indirmede güncel belgenin türü kullanılıyor → JPG olan v1, PDF uzantısıyla iniyor. |
| 37 | DOĞRULANDI | `audit.interceptor.ts` `resourceId`/`oldData`/`newData` yazmıyor, `action`'ı HTTP metodundan türetiyor, yalnız **başarıda** çalışıyor, hatayı yutuyor → "kim ne zaman" var, "neyi" yok. |
| 46 | DOĞRULANDI | `taxpayers.service.ts:883-903` kısa yollarda `taxpayerId`/`donem` yok; `bekleyenGun` genel `updatedAt`'ten hesaplanıyor → herhangi bir alan güncellenince gecikme sıfırlanıyor. |
| 49 | DOĞRULANDI | `mukellef/profil/page.tsx:27` min 6 karakter, sunucu (`taxpayer-portal.service.ts:780`) min 8. `beyanname-takip.service.ts:596` durum geri alınınca `onayTarihi` temizlenmiyor. |
| 40 | DOĞRULANDI | `message-templates.service.ts:188` `$transaction(updates).catch(() => null)` → sıra kaydedilmese de `{ ok: true }`. Duyuru taslakları `localStorage`'da, ofis/kullanıcı kimliği yok. |
| 25 | DOĞRULANDI | `yapilandirma-7582/page.tsx:339` mükellef değişince dört durumdan ikisini temizliyor; **doğrusu aynı dosyada 130. satırda zaten var** (dördünü de temizliyor). Görüntü sorunu, veri bozulmuyor. |
| 26 | DOĞRULANDI ama **mükellef karışması YOK** | Önbellek anahtarı kaynak kimliğini içeriyor, karışma olmuyor. Gerçek sorun **bayatlık**: `mali-yorum.service.ts:59-62` kaynağın değişip değişmediğine bakmıyor; İHÖ'de kaynak kimliği `taxpayerId:yil` olduğu için yıl boyunca sabit. Ayrıca ekranda "Bütün hesaplar inceleniyor" yazıyor ama kod `.slice(0, 250)` ile kesiyor. |
| 20 | DOĞRULANDI | `kdv-beyanname.service.ts:594-614` hata hâlinde satırı sıfırlarla döndürüyor, **hata işareti yok**; toplamlar eksik oluyor. `durum: 'hazir'` kararı (569-574) `veriGuveni` seviyesini hesaplayıp **kullanmıyor** → kaynak farkı olan mükellef "Hazır" görünüyor. |
| 22 | DOĞRULANDI ama **en düşük öncelik** | Gösterilen gelir cari tahsilatı içeriyor, ödeme kapasitesi (`aylikOrtalamaAkis`, 2299) **içermiyor** → 120.000 ₺ gelir görünürken kapasite 0 ₺ çıkabiliyor. `OwnerOnlyGuard` + PIN arkasında, yalnız ofis sahibi görüyor. |
| 16 | DOĞRULANDI | (yukarıda, KDV Kontrol grubunda) |

---

### GÖRÜNÜRLÜK GRUBU — UYGULANANLAR (2026-09-25)

**33 — sistem sağlığı ofis bazlı oldu.** Ajan/oturum/kuyruk sorgularının hepsine `tenantId`
eklendi; `runAllChecks` ofisler üzerinde dönüyor, altyapı kontrolleri (MODULE_HASH, DB_HEALTH)
ofisten bağımsız kalıyor (`tenantId: null`). `upsertCheck` tekilleştirmesi ve `resolveCheck`
kapatması da ofise bağlandı — yoksa A ofisinin açık uyarısını B ofisinin kontrolü kapatıyordu.
`getActiveAlerts` ofisin kendi uyarıları + altyapı uyarılarını veriyor.

> **Denetimde olmayan ek bulgu:** `checkMihsapTokenAge` şemada **olmayan** bir modeli çağırıyordu
> (`mihsapToken`; doğrusu `mihsapSession`, tablo `mihsap_sessions`). Her çalışmada
> "Cannot read properties of undefined" fırlatıp dıştaki `catch`'e düşüyordu — **bu kontrol
> bugüne kadar tek uyarı üretmedi.** Düzeltildi.

> **Geçiş temizliği:** Canlı ölçümde açık 2 uyarı vardı, ikisi de `tenantId: null` ve ikisi de
> ofis bazlı tipte (LUCA_JOB_FAILURE, LUCA_TOKEN_AGE). Ofis bazlı düzene geçince bunlar hiçbir
> kontrol tarafından kapatılamaz ve "altyapı uyarısı" sayıldıkları için HER ofiste asılı
> kalırdı. `ofissizEskiUyarilariKapat()` bunları bir kez kapatıyor; koşul sürüyorsa aynı tur
> içinde ofis bazlı olarak yeniden açılıyor.

**34 — ertelemesi biten görev sayaçta.** Gecikmiş sayacı artık ekranın tanımıyla aynı:
süresi dolmuş `SNOOZED` görevler de gecikmiş. Hâlâ ertelemede olanlar sayılmıyor.
Sınama tarafında bir **bayat fikstür** bulundu: `g4` (SNOOZED, vadesi geçmiş, erteleme bitişi
yok) *"açık ama gecikmiş sayılmaz"* diye çivilenmişti — oysa ekran onu zaten gecikmiş
gösteriyordu. Ayrıca sahte prisma `OR` desteklemiyordu, yani yeni sayaç sorgusu hiç
sınanmamış olurdu (beklenen 1, gelen 7). İkisi de düzeltildi.

**42 — tek başarısız HGS sorgusu ihlalleri silmiyor.** Özet artık son **başarılı** sonuçtan
üretiliyor; `durum` alanı boş eski kayıtlarda eski davranış korundu. Yanıt
`sonSorgusuBasarisiz` ve `hicBasariliSorguYok` sayaçlarını da taşıyor, `[HGS-OZET]` kaydı düşüyor.

**44 — "Sorun yok" yalanı kalktı.** `KritikUyariStatCard` artık `isError` okuyor: sağlık verisi
okunamazsa sayı yerine `—`, metin *"Sistem durumu okunamadı — 'sorun yok' anlamına gelmez"*
ve tıklanır "Yeniden dene". Panelde `queueUnavailable` bayrağı ilk kez **okunuyor**: iş yükü
sayacı bilinmiyorsa `—` gösteriyor, *"Okunamadı — 'iş yok' anlamına gelmez"* diyor.

**45 — evrak bekleyenler artık sırada.** `siradaki` listesinden `EVRAK_BEKLIYOR` dışlaması ve
`.slice(0, 10)` kırpması kaldırıldı. Sıralama önceliğinde `EVRAK_BEKLIYOR` zaten en sonda
(stageOrder 5), yani "sıradaki iş" önerisi değişmiyor; yalnız ekranın "Geç Kalanlar" süzgeci
artık onları da görüyor.

**46 — gecikme artık sıfırlanmıyor (kısmen).** `bekleyenGun` hesabı aşamaya göre ayrıldı:
`EVRAK_BEKLIYOR` → dönem başı (ya da mükellefiyet başlangıcı); `ISLENMEYI/KONTROL` →
`evraklarIslendiAt` damgası varsa ondan; diğerleri → eski `updatedAt`.
**Tam çözüm için şema değişikliği gerekiyor:** `TaxpayerMonthlyStatus`'ta aşama başına damga
yok, elde yalnız `evraklarIslendiAt` var. Şemanın kendi notu da durumu söylüyor:
*"updatedAt kullanılamaz: başka alan güncellenince tazelenir."*

**Sınama:** `scripts/gorunurluk-regression.cjs` (21 kontrol, zincirde). Her düzeltme tek tek
kapsanıyor — mutasyonda sırasıyla 2, 1, 1, 1, 2, 4, 2 kontrol düşüyor.

**BU GRUPTA ELE ALINANLAR AŞAĞIDA.**

---

### KALAN GRUP — UYGULANANLAR (2026-09-25)

**35 — sessiz kırpma kalktı (en kritik yeri).** `taxpayer-portal.service.ts` `getEvraklar`
EN YENİ 300 belgeyi çekip SONRA bellekte "elle yüklenen" süzgecini uyguluyordu; otomatik
inen belgeler o 300'ü doldurunca **mükellefin kendi dosyaları hiç görünmüyordu**. Artık
elle-yüklenen sayısı yeterli olana kadar sayfa sayfa okunuyor (500'lük turlar, en çok 20 tur);
tükenmeden durulursa kayda uyarı düşüyor.
**Canlı ölçüm:** En çok belgesi olan 8 mükellefte 3.000–5.000 belge var ve **hepsi otomatik** —
yani bugün gizlenen belge yok. Ama bu mükelleflerden biri dosya yüklerse, gelen otomatik
belgeler onu birkaç gün içinde 300'ün dışına itiyordu.
*(Diğer `take` sınırları — documents:250 take 100, tasks:464 take 500, office-chat:115 take 80 —
bu turda ELE ALINMADI; onlarda süzme bellekte değil, kırpma doğrudan listenin kendisinde.)*

**48 — tavan kalktı, seçim veritabanına indi.** `genel-sorgular` "mükellef başına en son"
seçimini 4.000 satır çekip BELLEKTE yapıyordu. Artık Postgres `DISTINCT ON` ile her mükellef
(+ay bazlıysa dönem) için yalnız en son satır okunuyor. `DISTINCT ON` çalışmazsa eski yola
düşülüyor ama tavan 20.000'e çıkarıldı ve tavana değilirse kayda uyarı düşüyor.
**Önce/sonra canlı karşılaştırma:** sonuç birebir aynı (POS 4, GELEN_EARSIV 196, E_HACIZ 19) —
4.000 tavanına bugün ulaşılmıyor. Düzeltme ileriye dönük.

**32 — "okundu" damgası artık bağlantıdan SONRA.** `viewedAt` presigned bağlantı üretilmeden
önce yazılıyordu: depo erişilemezken mükellef belgeyi görmediği hâlde tebligat "okundu"
işaretleniyor, ofisin okunmamış sayacı onu bir daha göstermiyordu. e-Tebligat'ta okunma anı
hukuken anlamlı.
*(32'nin ikinci yarısı — ofis geneli bildirimde kullanıcı bazlı okundu tablosu — ŞEMA
DEĞİŞİKLİĞİ ister; UYGULANMADI.)*

**36 — eski sürüm kendi türüyle iniyor.** `DocumentVersion`'da `mimeType` yok; indirme/önizleme
hep GÜNCEL belgenin türünü kullanıyordu (JPG olan v1, `application/pdf` ile). Sürümün kendi
nesne anahtarındaki uzantıdan tür çıkarılıyor; uzantı yoksa eski davranışa düşülüyor.
*(Kalıcı çözüm `DocumentVersion.mimeType` kolonu — migration + eski satırlar için geri dolum ister.)*

**37 — denetim günlüğü artık "neyi" de yazıyor.** Interceptor yeniden yazıldı:
`resourceId` yoldan/yanıttan çözülüyor · `action` yol ekiyle zenginleşiyor (`POST /x/:id/iptal`
artık `CREATE_IPTAL`, eskiden düz `CREATE`) · istek gövdesi `newData`'ya yazılıyor ·
`userAgent` yazılıyor · **başarısız denemeler de iz bırakıyor** (hata mesajı + durum kodu) ·
günlük yazılamazsa sessizce yutulmuyor, `[DENETIM-GUNLUGU]` kaydı düşüyor.
**Gizlilik:** gövde olduğu gibi saklanmaz — parola/jeton/anahtar/base64 benzeri alanlar `***`
ile maskelenir, uzun metinler kırpılır, gövde 4.000 karakterle sınırlıdır. Okuma (GET)
istekleri günlüğe girmemeye devam ediyor.

**40 — "kaydedildi" yalanı kalktı.** Şablon sırası `$transaction(...).catch(() => null)` ile
yutuluyor, her hâlükârda `{ ok: true }` dönüyordu. Artık hata kullanıcıya bildiriliyor.

**49 — iki uçuş.** Mükellef profilinde şifre en az **8** karakter (sunucuyla aynı; ekran 6
diyordu, mükellef 7 girip sunucudan hata alıyor ve sebebini anlamıyordu). Beyanname durumu
geri alınınca `onayTarihi` **temizleniyor** — eskiden "beklemede" görünen kaydın üstünde eski
onay tarihi kalıyor, raporlar onu "verildi" diye okuyordu.

**25 — mükellef değişince dört durumun dördü de temizleniyor.** Eskiden `sonuc` ve `plan`
ekranda kalıyor, yeni seçilen mükellefin ekranında ÖNCEKİ mükellefin yapılandırma planı
görünüyordu. Doğrusu aynı dosyada `mukellefeGec` içinde zaten vardı.

**26 — bayat yorum işaretli + AI'a dürüst metin.** Yorum önbelleği kaynağın değişip
değişmediğine bakmıyordu; İHÖ'de anahtar `taxpayerId:yil` olduğu için Ocak'ta üretilen yorum
Aralık'ta hâlâ "güncel" gibi görünüyordu. Artık kaynağın son değişikliği yorumdan yeniyse
`bayat: true` dönüyor ve ekranda *"Bu değerlendirmeden sonra veriler değişti"* uyarısı çıkıyor.
Ayrıca prompt "bakiyesi olan N hesap" deyip yalnız 250'sini gönderiyordu — sınır 600'e çıkarıldı
ve kesilme AI'a açıkça bildiriliyor.

**20 — hata "veri yok" diye gizlenmiyor + veri güveni karara giriyor.** KDV genel bakışta
hata hâlinde satır SIFIRLARLA ve `durum: 'bos'` ile dönüyordu: ekranda "bu mükellefte KDV yok"
gibi görünüyor, listenin toplamları sessizce eksik çıkıyordu. Artık `durum: 'hata'`, tutarlar
`null`, sebep satırda, toplamlarda sayılmıyor ve `hataAdet` ayrıca bildiriliyor. Ekrana
"Hesaplanamadı" rozeti eklendi. Ayrıca `veriGuveni` hesaplanıp KULLANILMIYORDU — artık yalnız
güveni "kesin" olan mükellef "Hazır" görünüyor.

**22 — ödeme kapasitesi ekrandaki gelirle aynı tanımı kullanıyor.** Gösterilen gelir cari
tahsilatı içeriyordu, kapasite hesabı içermiyordu; bu ofiste gelirin büyük kısmı müşteri
tahsilatı olduğu için ekran "120.000 ₺ gelir" derken "her ay 0 ₺ ayırabilirsiniz" diyebiliyordu.
`aylikOrtalamaAkis` artık `cariTahsilatDonemHaritasi`'nı da topluyor.

**Sınama:** `scripts/sessiz-kayip-regression.cjs` (33 kontrol, zincirde). Mutasyonda sırasıyla
35→2, 32→1, 36→1, 40→2, 49→1, 20→1, 37→4 kontrol düşüyor. 25 ve 22 için ayrı davranış testi
YOK (25 saf ekran durumu; 22 sahip PIN'i arkasında bütçe hesabı) — yalnız tip kontrolünden geçti.

**HÂLÂ AÇIK:** 32'nin kullanıcı bazlı okundu tablosu · 36'nın kalıcı `mimeType` kolonu ·
46'nın aşama başına zaman damgası · 35'in diğer `take` sınırları. Dördü de ŞEMA/MİMARİ
değişikliği ister ve ayrı bir tur olarak planlanmalı.



---

# 8. MEVCUT SINAMALARIN KAÇIRDIKLARI

Kullanıcının özellikle sorduğu madde. Tespitler:

1. **Push kapısı bu testleri çalıştırmıyor.** `scripts/git-hooks/pre-push` yalnız `pnpm test:contracts`
   çağırıyor — o da üç betik. Bu oturumda Fatura Merkezi için yazılan davranış sınamaları
   `test:regression` içinde, yani **push'ta koşmuyor**.
2. **Ofisler arası izolasyonu sınayan tek bir betik yok.** 50+ regresyon betiği tarandı; hiçbiri
   "B ofisinin anahtarıyla A ofisinin kaydına erişilebiliyor mu" sorusunu sormuyor.
   `luca-isolation-regression.cjs` adı yanıltıcı — o **bilgisayarlar arası** izolasyonu koruyor.
3. **Yanıt alanı sınaması yok.** Hiçbir test "yanıtta `passwordHash`/`portalPasswordHash`/`totpSecret`
   olmamalı" demiyor. Tek kural bulgu 04'ü yakalardı.
4. **Olumsuz rol sınaması yok.** "STAFF bu ucu açamaz" diyen test olmadığı için Drive'daki eksik guard
   görünmüyor.
5. **Bir test hatayı beklenen davranış olarak sabitlemiş:** `vergi-takvimi-tohum.spec.ts:14`
   `expect(...).toBe('2026-09-26')` — 26 Eylül 2026 **Cumartesi**. Yani yanlış tarih teste çivilenmiş.
6. **İzole doğru, bütünleşik yanlış:** `is-gunu.spec.ts` `ilkIsGunu`'yu tek başına sınıyor ve geçiyor;
   hiçbir test onun gerçekten **uygulandığını** doğrulamıyor.
7. **Test olmayan modüller:** `isletme-hesap-ozeti`, `kdv-beyanname`, `mihsap`, `banka-takip`, `galeri`,
   `fis-yazdirma` (arşiv), `mali-yorum`, `ekip-onay` — hiç `.spec` yok.
8. **Yan etki sınanmıyor:** Testler dönüş değerine bakıyor, çağrı sonrası veritabanı durumuna bakmıyor —
   bulgu 21 (okuma yazıyor) tam bu yüzden görünmüyor.
9. **Depolama/uzak sistem hatası taklit edilmiyor:** Sınamalarda S3 ve Mihsap hep çalışıyor; bulgu 17,
   30, 38 bu yüzden kaçmış.

**Önerilen yeni sınama:** `scripts/tenant-izolasyon-regression.cjs` — sahte Prisma istemcisiyle,
ofis kimliği taşıması gereken her servis metodunun `where` koşulunda `tenantId` olduğunu doğrulasın;
`agent-token.ts` için kısa adın `allowLegacyLookup=false` iken **reddedildiğini** sınasın (bugün kırmızı
verir). `test:contracts` listesine eklenip push kapısına alınsın.

---

# 9. KİLİTLİ MODÜL UYARISI

`KILITLI_MODULLER.md`'ye göre aşağıdaki bulgular **dokunmak için ayrı izin gerektiren** modüllerde:

| Bulgu | Modül |
|---|---|
| 03, 15, 16, 17, 20 | KDV Kontrol (`apps/api/src/kdv-control/`) |
| 10 | Mizan (`apps/api/src/mizan/`) |
| 28, 30 (kısmen) | Luca yerel ajan / agent-runtime akışları |

`apps/api/src/luca/` (sunucu tarafı) kilitli **değil** — bulgu 01 ve 02 serbestçe düzeltilebilir.

---

# 10. ÖNERİLEN UYGULAMA SIRASI

**Faz A — Güvenlik (bugün):**
1. Bulgu 01: `agent-token.ts` blok kaydırma + `cari-kasa.controller.ts:590` kopyası.
2. Bulgu 02: beş uçta ofis kimliği `where`'e eklensin.
3. Bulgu 13: kütle atama kapatılsın (izinli alan listesi), `tenantId` gövdeden asla alınmasın.

**Faz B — Mükellefe giden yanlış bilgi:**
4. Bulgu 11: `select` düzeltmesi + gönderim kapısı.
5. Bulgu 19: `isError` ele alınsın, ekstre düğmesi kilitlensin.
6. Bulgu 18: `kaynak` alanı + etiket düzeltmesi.
7. Bulgu 43: `ilkIsGunu` her yerde; yanlış tarihi çivileyen test düzeltilsin.

**Faz C — Veri kaybı:**
8. Bulgu 38: silme çekimden sonraya, `faturaTuru`/`kaynak` süzgeci.
9. Bulgu 10: `importFromExcel` kilit kontrolü + silme sırası.
10. Bulgu 21: okuma yollarından yazma kaldırılsın.
11. Bulgu 39: bulgu eşleşme anahtarı + karar/not korunsun.

**Faz D — Çift işlem ve sahte başarı:**
12. Bulgu 30, 29, 27, 28, 31, 41.

**Faz E — Sahiplik ve görünürlük:**
13. Bulgu 12, 14, 23, 03, 47.
14. Görünürlük grubu (44, 42, 45, 35, 48, 32, 33, 34, 36, 37, 46, 49, 40) — 7'si ortak iki kalıpla
    kapanıyor.

**Faz F — Test güvencesi:**
15. `tenant-izolasyon-regression.cjs`; yanıt alanı sınaması; olumsuz rol sınaması; `test:contracts`
    listesinin push kapısında genişletilmesi.

Canlıya alma her fazda ayrı onay gerektirir.
