# e-Beyanname İndirme — Teşhis ve Devir Notları (Codex için)

Bu doküman, e-Beyanname indirme akışındaki sorunların **gerçek GİB sayfası incelenerek** doğrulanmış kök-sebep analizini, denenenleri, mevcut kod durumunu ve önerilen çözümü içerir. Amaç: bu işi **yerelde, test ederek** bitirmek (uzaktan kör deploy ile değil).

## 1. Bağlam

- **Repo:** `mali-musavir-app` (monorepo, NestJS API + Next.js web).
- **İlgili dosya:** `apps/api/src/portal-automation/portal-automation-railway-runner.service.ts`
- **Akış:** Runner (Railway / local worker), `dijital.gib.gov.tr` → e-Beyanname uygulamasına Playwright (headless Chromium) ile mali müşavir kullanıcı kodu/şifre + CAPTCHA (2captcha) ile giriş yapar → "Beyanname Ara" sonuç tablosunu gezip her satırın **beyanname** ve **tahakkuk** PDF'lerini indirir → portala (beyanKaydi / beyanDurumu) kaydeder.
- **İş tipi:** `EBEYANNAME_DAILY_DOWNLOAD` (portal-automation-job kuyruğu).

## 2. Yaşanan Belirtiler

1. **"Çoğunun beyannamesi yok"** — indirilen satırların çoğunda PDF bağlanmıyor (beyanKaydi oluşuyor ama `beyannameUrl`/`pdfUrl` boş; portalda "PDF eksik: N beyanname, M tahakkuk, K tamamen boş kayıt").
2. **Swap** — bazı kayıtlarda beyannameye tıklayınca tahakkuk açılıyor (beyanname/tahakkuk dosyaları yer değiştirmiş).
3. **"Tutar okunamadı"** — tahakkuk tutarı PDF'ten parse edilemiyor.
4. **Yavaşlık** — indirme ~30 dk+ sürüyor; Hattat aynı işi ~5 dk'da yapıyor.
5. Mükellef eşleştirme (matchTaxpayerId) ise **doğru çalışıyor** (isim/VKN/tür/dönem doğru).

## 3. KÖK SEBEP (gerçek GİB DOM'u incelenerek doğrulandı)

e-Beyanname sonuç tablosunda PDF indirme **linkleri `href` DEĞİL** — bir resim + JS onclick:

| Belge | `<img src>` | `onclick` fonksiyonu | `title` |
|---|---|---|---|
| Beyanname | `pdf_b.gif` | `beyannameGoruntule(...)` | "Beyannameyi PDF Formatında görüntülemek için tıklayınız." |
| Tahakkuk | `pdf_t.gif` | `tahakkukGoruntule(...)` | "Tahakkuku PDF Formatında görüntülemek için tıklayınız." |

Çağrı zinciri (doğrulandı):

```
beyannameGoruntule(rowData)  ->  callMenuUrlPopUp(url, ...)  ->  window.open(GERCEK_PDF_URL, name, "width=...,height=...")
```

- `callMenuUrlPopUp` → `window.open(...)` ile **popup pencere** açar.
- Gerçek PDF URL'i tıklama anında **`getTOKEN()` + `getParameterForArsiv(...)`** ile üretilir (oturum token'ı + satır parametreleri).

### Bunun yarattığı sonuçlar
- **DOM'da fetch edilebilir URL yok** → kodun `directEBeyannameUrlFromMeta` / `tryDownloadEBeyannameDirect` yöntemi `null` döner → **HTTP/direkt indirme bu sayfada imkânsız**. Kod bu yüzden popup-yakalama (`captureEBeyannameDownload`) fallback'ine düşüyor.
- **Popup-yakalama güvenilmez** (zamanlama/pencere yarışı) → çoğu satırda PDF yakalanamıyor = **"çoğunun beyannamesi yok"**.
- Aynı popup yarışı **beyanname↔tahakkuk swap**'ine yol açıyor.
- **`pdf-parse` bazı GİB PDF'lerinin metnini çıkaramıyor** → tahakkuk tutarı ("Tutar okunamadı") ve owner-validator'daki VKN kontrolü ("PDF içinde VKN okunamadı") başarısız oluyor. (Not: en az bir beyanname PDF'i düz metin olarak okunabildi — yani hepsi resim değil; tahakkuk tarafı veya parse formatı incelenmeli.)
- **Hız:** Tek çözüm tıklama olduğu için ve tıklamalar tek sayfada **seri** olduğu için Hattat hızına ulaşılamıyor. Hattat büyük ihtimalle tıklamadan URL'leri kurup **paralel** indiriyor.

## 4. ÖNERİLEN ÇÖZÜM

### A) Doğruluk + Hız (asıl çözüm)
Tıklama yerine **gerçek PDF URL'lerini elde edip paralel indir.** İki yol:

1. **Tercih edilen:** `getParameterForArsiv()` + `getTOKEN()` mantığını `page.evaluate` içinde **çağırıp** her satırın beyanname/tahakkuk URL'ini **tek geçişte** üret (tıklamadan). Bu fonksiyonların imzasını/çıktısını gerçek sayfada inceleyin.
2. **Alternatif (daha kolay, kısmen uygulandı):** `window.open`'u `page.evaluate` ile araya girip (override edip) ikonun onclick'ini tetikleyerek üretilen URL'i yakala. Bu repo'da `captureEBeyannameUrlViaClick` olarak EKLENDİ — **çalışıyor ama satır-başına tıklama gerektirdiği için seri/yavaş**.

Her iki yolda da: URL'ler toplandıktan sonra **`page.context().request.get(url)`** ile (oturum çerezi paylaşımlı) **paralel** indir. Beyanname/tahakkuk ayrımını **onclick fn adı** (`beyannameGoruntule` vs `tahakkukGoruntule`) veya **src** (`pdf_b` vs `pdf_t`) ile yap — güvenilir.

### B) "Tutar okunamadı" / VKN okunamadı
- `pdfTextFromBase64` (pdf-parse) boş dönerse **OCR fallback** kullan (repoda Azure Vision / Claude OCR mevcut, sadece beyanname indirme tarafı bunu kullanmıyor).
- Owner-validator (`validateEBeyannameFileOwner`) PDF VKN'sini **okuyamadığında REDDETMESİN** — sadece **net farklı bir VKN** bulunduğunda reddetsin (şu an okunamayınca da reddediyor → fazla agresif).

## 5. Bu oturumda yapılan değişiklikler (mevcut kod durumu)

`portal-automation-railway-runner.service.ts` içinde:
- `collectApprovedEBeyannamePages`: 3 fazlı yapı (plan → paralel HTTP ön-getirme → seri birleştirme) eklendi. **Not:** HTTP ön-getirme bu sayfada işe yaramıyor (URL yok).
- `enumerateRowFileMetas`: satır öğelerini tek `evaluateAll` ile toplama (round-trip azaltma).
- `captureEBeyannameUrlViaClick`: window.open intercept ile gerçek URL yakalama (çalışır, seri).
- `fixEBeyannameTahakkukSwap` + `detectEBeyannameDocType`: PDF içeriğine göre swap düzeltme (PDF metni okunamazsa no-op).
- `[EBDBG]` teşhis logları (sequence<=8) — temizlenebilir.
- Env bayrakları: `PORTAL_AUTOMATION_EBEYANNAME_PARALLEL`, `_DIRECT_FETCH`, `_CONCURRENCY`, `_RUNNER_VALIDATE_PDF_OWNER`, `_DOWNLOAD_EVENT_TIMEOUT_MS`, `_FILE_TIMEOUT_MS`, `_RUNNER_MODE` (server/local).

**UYARI:** Son aktif deploy ("perf: serial url capture + parallel http download") bazı run'larda **takılıyor** (assembly'de seri tıklama-yakalama yavaş/kilitleniyor). Devam etmeden önce bu sürümü gözden geçirin veya bir önceki ("fix: capture real pdf url via window.open intercept") sürüme dönün.

## 6. Build/Altyapı notu
- Railway build'inde **`sharp`** native modülü bazen kurulamıyor (linux-x64 binary) → deploy "Crashed". Kararsız; genelde **Redeploy** çözüyor. Dockerfile'da sharp platform binary'sini garanti altına almak iyi olur.

## 7. Dokunulması gereken anahtar fonksiyonlar
`parseEBeyannameResultRows`, `normalizeEBeyannameResultRow`, `pickEBeyannameFileCandidate`, `enumerateRowFileMetas`, `downloadEBeyannameRowFile`, `captureEBeyannameDownload`, `savePdfFromRequestUrl`, `tryDownloadEBeyannameDirect`, `directEBeyannameUrlFromMeta`, `captureEBeyannameUrlViaClick`, `validateEBeyannameFileOwner`, `pdfTextFromBase64`, `collectApprovedEBeyannamePages`, `matchTaxpayerId`.

## 8. Test önerisi
- Yerelde gerçek GİB oturumuyla (veya kaydedilmiş bir result sayfasıyla) çalış; **kör production deploy yapma**.
- Önce `getParameterForArsiv`/`getTOKEN` ile URL üretmeyi doğrula (tek satır), sonra paralel indirmeyi ölçekle.
- Doğruluk kontrolü: indirilen PDF'in başlığı/VKN'si satırla eşleşiyor mu, beyanname/tahakkuk doğru mu.

## 9. ÇÖZÜM (2026-06-04) — "gri göz / Tutar okunamadı" gerçek kök sebebi

Yukarıdaki notlar yazıldığından beri akış **liste-API (ARSIVBEYANNAMELISTESI + /dispatch IMAJ, Oid bazlı)** yoluna geçti; tıklama/popup büyük ölçüde aşıldı. Kalan şikâyet ("çoğunun PDF'i yok / Tutar okunamadı") incelendi:

- **Parser sağlam.** Kullanıcının verdiği 2 GİB PDF'i production `pdf-parse` (PDFParse v2) ile birebir test edildi: metin tam çıktı, tahakkuk tutarı (939,70) doğru okundu. "Resim tabanlı PDF" teorisi yanlış.
- **Gri göz = `pdfUrl`/`beyannameUrl` DB'de boş** (frontend `hasFile = !!pdfUrl`). S3 dosya kaybı değil, alanın kendisi null.
- **Kök sebep (b) — fazla agresif sahip-doğrulayıcı:** `portal-automation.service.ts > prepareIncomingDeclarationPdf`, tahakkuk/beyanname PDF metninde mükellef VKN'sini net bulamayınca PDF'teki **başka bir 10-11 haneli numarayı** (çoğu zaman e-beyannameyi gönderen **meslek mensubu/mali müşavir VKN'si** ya da bir **telefon numarası**) "asıl sahip" sanıp belgeyi başka kayda taşıyor ve asıl kaydın URL'sini `clearCurrent:true` ile **siliyordu**. Tahakkuk tutarı silinmediği için "tutar dolu ama göz gri" oluşuyordu. → **Düzeltildi:** liste-API'de PDF kendi Oid'iyle indiği + eşleşme satır verisinden yapıldığı için belge otoriter kabul edilir; PDF-içi metne bakarak eldeki dosya artık taşınmaz/silinmez (yalnızca teşhis logu).
- **Kök sebep (a) — aralıklı indirme hatası:** GİB 500/hız-limiti yüzünden bazı satırların PDF'i inmiyordu (tek deneme + 1 retry yetersiz). → **Düzeltildi:** `...-railway-runner.service.ts` liste-API indirmesi artık **artan beklemeli 4 deneme** (env `PORTAL_AUTOMATION_EBEYANNAME_FETCH_ATTEMPTS`).

Commit `d01665d`. Kendi kendini onarır: sonraki gece taraması / "Var olanları da yeniden indir" düğmesi gri kayıtları yeniden indirip linki korur. **Kalan opsiyonel iş:** gerçekten hiç inmeyen satırlar için iş-sonu süpürme turu.
