# Görev: Mali Müşavir App — Modül İzolasyonu ve Regression Guard

## Bağlam

Bu repo `mali-musavir-app`, NestJS API (`apps/api`) + Next.js portal (`apps/web`) + Playwright local agent (`apps/luca-local-agent`) içeren bir turborepo. Mali müşavirler için Luca muhasebe yazılımıyla otomasyon, OCR, KDV kontrol ve raporlama yapıyor.

Sorun: Her modüle dokunulduğunda başka modüller kırılıyor. Aynı kod iki dosyada (`agent-runtime.js` + `moren-agent.js`) yaşıyor, regression test yok, kritik dosyalar 4K-13K satır, "her ay bozulma" döngüsü var.

Bu görev 2 haftalık (7-10 iş günü) bir temizlik. Üç faz halinde yapılacak. Tüm fazlar birbirinden bağımsız ilerleyebilir ama önerilen sıra: Faz 1 → Faz 2 → Faz 3.

## Faz 1 — Tek kaynaklı agent kodu (4-6 saat, kritik)

### Sorun
`apps/api/public/agent-runtime.js` (Railway servis ediyor) ve `apps/web/public/moren-agent.js` (Vercel servis ediyor) %99 aynı kod ama iki ayrı dosya. Yakın geçmişte commit'ler sadece bir tarafa gitti, diğeri 3 sürüm geride kaldı → portal modülleri sessizce kırıldı.

### Yapılacaklar

1. **Build-time auto-copy ekle:**
   - `agent-runtime.js`'i tek kaynak yap.
   - `apps/web/package.json` içinde build script'inden önce `apps/api/public/agent-runtime.js`'i `apps/web/public/moren-agent.js`'e kopyalayan adım ekle. Önerilen: `prebuild` veya `predev` script'i, basit `cp` veya `node -e "fs.copyFileSync(...)"`.
   - Hem `next dev` hem `next build`'den önce çalışsın.
   - Turbo (`turbo.json`) `web#build` task'ının inputs'una `apps/api/public/agent-runtime.js`'i ekle ki o değişince web rebuild'lensin.

2. **`moren-agent.js`'i git'ten kaldır:**
   - Generated artifact olduğu için `.gitignore`'a ekle.
   - `git rm apps/web/public/moren-agent.js` yap.
   - Yedek dosya `apps/web/public/moren-agent.js.bak-v1.37.71` varsa onu da sil.

3. **Pre-commit guard ekle:**
   - Mevcut `.husky/pre-commit` hook'una şu kontrolü ekle:
     - Eğer `apps/api/public/agent-runtime.js` staged'da ise commit'e izin ver (artifact build'te üretilecek).
     - Eğer `apps/web/public/moren-agent.js` staged'da ise commit reddet — "bu dosya artifact, kaynağı `agent-runtime.js`" mesajıyla.

4. **CI/build guard:**
   - Vercel build'inde başta script çalışsın: `agent-runtime.js`'in son sha256 hash'iyle son committed `moren-agent.js`'in hash'i (varsa) karşılaştır. Farklıysa hata vermesin (zaten ignore edildi) ama build log'da hash görünsün.
   - GitHub Actions varsa `.github/workflows/`'ya basit bir hash check job'ı ekle.

### Definition of Done — Faz 1
- `moren-agent.js` git tracking dışında, sadece build output olarak üretiliyor.
- `agent-runtime.js`'e push yapıldığında Vercel deploy'unda da yeni sürüm yayımlanıyor.
- `agent-runtime.js` ve build sonrası `moren-agent.js` bytewise aynı.
- Test: bir karakter değiştir `agent-runtime.js`'de, lokal `next build` çalıştır, `apps/web/public/moren-agent.js` güncelleniyor mu doğrula.

---

## Faz 2 — Snapshot regression testleri (8-10 saat)

### Sorun
Bug fix yapıldığında başka bir davranış sessizce kırılıyor, kimse fark etmiyor, user şikayet edince anlaşılıyor.

### Yapılacaklar

1. **Test infra'sı:**
   - `apps/api`'de Jest zaten kurulu olmalı (NestJS default). Yoksa kur.
   - `apps/api/src/kdv-control/__tests__/fixtures/` klasörü oluştur.

2. **KDV Kontrol için fixture'lar:**
   - `fixtures/reconciliation/` altına şu yapıyı koy:
     ```
     case-01-strict-match/
       luca-records.json     (mock KdvRecord[])
       images.json           (mock ReceiptImage[])
       expected.json         (beklenen reconciliation çıktısı)
     case-02-leading-zero-different-doc/
       luca-records.json     (Luca 620 / 26.04 / 237 TL)
       images.json           (e-fatura 0620 / 02.04 / 162 TL)
       expected.json         (her ikisi de UNMATCHED, pair olmamalı)
     case-03-same-date-amount-different-belgeno/
       luca-records.json     (560 / 14.04 / 1094)
       images.json           (AKG2026...0107 / 14.04 / 1094)
       expected.json         (PARTIAL_MATCH veya MATCHED, kullanıcı kararına göre)
     case-04-tarih-format-mm-dd/
       luca-records.json     (Luca tarih 04.01.2026 olarak parse edilmiş)
       images.json           (e-fatura 01.04.2026)
       expected.json         (kullanıcı bekliyor: doğru eşleşme — eğer Luca parser hatası varsa fixture buna pinli)
     ```
   - Minimum 10 fixture, her biri reel veriden alınmış.

3. **Test runner:**
   - `apps/api/src/kdv-control/__tests__/reconciliation.spec.ts` oluştur.
   - `ReconciliationEngine`'i instantiate edip her fixture için `expected.json` ile karşılaştır.
   - Jest snapshot kullan: `expect(result).toMatchSnapshot()` veya direct deep equal.

4. **OCR için fixture'lar:**
   - `apps/api/src/kdv-control/__tests__/fixtures/ocr/` altında 10 reel belge:
     - 3 Z raporu (tek oranlı, çok oranlı, kümülatif tuzaklı)
     - 3 ÖKC fişi
     - 2 e-fatura PDF
     - 2 manuel makbuz
   - Her klasörde `image.jpg` (veya `.pdf`) + `expected.json` (`OcrResult` schema).
   - `ocr.service.spec.ts` — OcrService'i çağır, expected ile compare et.
   - Azure key gerektiren testler için CI'da `AZURE_VISION_KEY` env var, lokalde `.env.test`. Key yoksa testler skip.

5. **Luca agent için fixture'lar:**
   - Bu daha zor çünkü gerçek Luca DOM'u var. Şimdilik atla — Faz 3'te ele alınacak.

6. **CI entegrasyonu:**
   - `package.json`'a `test:regression` script ekle.
   - GitHub Actions workflow'una bu testleri ekle, PR check'i yap.
   - Snapshot fail olursa PR merge edilemesin.

### Definition of Done — Faz 2
- `pnpm test:regression` lokal'de çalışıyor, mevcut tüm fixture'ları geçiyor.
- CI her PR'de bu testleri koşuyor.
- Bugünkü Excel raporundaki "Satır 17 yanlış pair" senaryosu test'e dönüştürülmüş, regression olursa CI red.
- Yeni bir bug fix yapıldığında yazar bir fixture eklemek zorunda (PR review kuralı).

---

## Faz 3 — Mega dosyaları parçala (1 hafta)

### Sorun
`reconciliation.engine.ts` 1.3K satır, `ocr.service.ts` 4K satır, `agent-runtime.js` 13K satır. Tek dosyada IF/OR yığını → değişiklik yan etki yaratıyor.

### Yapılacaklar

#### 3A — `reconciliation.engine.ts` parçala

Mevcut dosya: `apps/api/src/kdv-control/reconciliation.engine.ts` (1.3K satır)

Hedef yapı:
```
apps/api/src/kdv-control/reconciliation/
├── index.ts                    (public API: ReconciliationEngine class)
├── engine.ts                   (orchestrator, ana akış — eski engine.ts'in shell'i)
├── types.ts                    (KdvRecord, ReceiptImage, MatchCandidate, MatchResult tipleri)
├── matching/
│   ├── strict-match.ts        (belge no + KDV + tarih TAM eşleşme)
│   ├── fuzzy-match.ts         (strongTwoOfThree, partial pair logic)
│   └── multi-rate-aggregate.ts (aggregateMultiRateRecords)
├── scoring/
│   └── score-calculator.ts    (calculateScore — pure function)
├── validators/
│   ├── seller-check.ts        (hasSellerMatch, VKN compare)
│   ├── date-helpers.ts        (parseTrDate, sameDay, MM.DD vs DD.MM detection)
│   ├── amount-check.ts        (parseMoneyLike, tolerance check)
│   └── belge-no-check.ts      (sameBelgeNo, stripLeadingZeros, eBelgeNoDistance)
└── status/
    └── score-to-status.ts     (scoreToStatus — pure)
```

Her dosya max ~300 satır. `index.ts` sadece `ReconciliationEngine` class'ını export etsin. Diğer modüller `kdv-control/reconciliation/internals`'a doğrudan import edemesin — eslint kuralı: `no-restricted-imports`.

Refactor sırasında:
- Hiçbir davranış değiştirme. Faz 2'de eklenen testlerin hepsi yeşil kalmalı.
- Pure function'ları (calculateScore, scoreToStatus, sameBelgeNo) önce ayır, ayrı unit test yaz.
- Sonra sınıf metodlarını dış modüllere taşı.
- Adım adım commit, her commit testler yeşil.

#### 3B — `ocr.service.ts` parçala

Mevcut dosya: `apps/api/src/kdv-control/ocr.service.ts` (4K satır)

Hedef yapı:
```
apps/api/src/kdv-control/ocr/
├── index.ts                    (public: OcrService class)
├── ocr.service.ts             (orchestrator)
├── types.ts                    (OcrResult, KdvBreakdownItem)
├── providers/
│   ├── azure-vision.ts        (Azure Read API çağrısı)
│   ├── claude-vision.ts       (Anthropic Claude vision)
│   └── ubl-xml-parser.ts      (e-fatura XML parse)
├── parsers/
│   ├── z-raporu-parser.ts     (extractZRaporuKdvFromAzure)
│   ├── okc-fis-parser.ts      (extractOkcFisKdvFromAzure)
│   ├── tevkifatli-parser.ts   (extractTevkifatliFaturaFromAzure)
│   ├── belge-no-extractor.ts  (extractBelgeNo, Z RAPORU önceliği)
│   ├── date-extractor.ts      (extractDate, extractPreferredInvoiceDate)
│   └── amount-extractor.ts    (extractKdvTotal, extractToplam)
├── validation/
│   ├── needs-review.ts        (needsReview — sanity checks)
│   ├── validate-result.ts     (validateOcrResult — math validation)
│   └── cross-check.ts         (crossCheckWithAzure)
└── post-process.ts            (postProcessOcrResult)
```

Aynı kural: davranış değişmemeli, testler yeşil kalmalı, eslint ile internals erişimi kapalı.

#### 3C — `agent-runtime.js` (opsiyonel, zor)

13K satır, browser-side JS, refactor için TypeScript'e taşımak ideal ama bu görevin kapsamı dışında. Bu fazda ATLA. Faz 2'deki guard'lar bu dosyayı koruyacak.

### Definition of Done — Faz 3
- `reconciliation/` ve `ocr/` klasörleri yukarıdaki yapıda.
- Her dosya max 400 satır.
- Faz 2'nin tüm testleri yeşil.
- Eslint kuralı: dış modüller `kdv-control/reconciliation/index` veya `kdv-control/ocr/index` dışında bir şey import edemiyor.
- Eski `reconciliation.engine.ts` ve `ocr.service.ts` dosyaları silinmiş (veya boş bırakılmış, re-export shim olarak).

---

## Genel Kurallar (her faz için)

### Yapma
- Mevcut davranışı değiştirme. Bu görev REFACTOR + GUARD, feature değil.
- Faz 2'nin testleri yeşil kalmalı. Bir test kırılırsa ya fixture'ı kasıtlı güncelle ya da değişikliği geri al.
- Mega-dosyaları parçalarken bir commit'te birden fazla dosyaya dağıtma. Adım adım, her adım test geçirir.
- `prisma/schema.prisma`'ya dokunma — DB schema bu görevin dışında.
- `apps/luca-local-agent/` koduna dokunma — büyük ihtimal regression yaratır, ayrı görev.

### Yap
- Her faz için bir branch aç: `cleanup/phase-1-single-source`, `cleanup/phase-2-snapshot-tests`, `cleanup/phase-3-split-megafiles`.
- PR mesajına "regression test yeşil" check'i koy.
- Her commit küçük ve anlamlı.

### Yardımcı bilgiler
- Repo manager: pnpm + turbo
- Test runner: Jest (`apps/api` için), Vitest yok.
- TypeScript strict mode aktif (büyük ihtimal).
- Pre-existing pre-commit: `.husky/pre-commit` — şu an `.locked-modules.json` kontrolü var.
- CI: Vercel auto-deploy (Vercel side), Railway auto-deploy (Railway side), GitHub Actions varsa orada.

## Sonuç beklenen

3 fazın sonunda:
- Bir dosyaya yapılan değişiklik o dosya dışına otomatik yayılmıyor (build-copy haricinde).
- Davranış değişikliği yapıldığında snapshot test'i kırar, anında belli olur.
- Yeni bir module katkıcı 13K satırlık dosya açmıyor, max 400 satırlık ilgili dosyayı açıyor.
- "Bir şeyi düzeltirken başka bir şeyi kırma" döngüsü %80 sönüyor.

Toplam tahmini süre: 7-10 iş günü. Faz 1 yalnız bile yapılırsa ay sonu 2-3 user şikayetini eler. Faz 2 ve 3 birlikte yapılırsa orta vadede her şikayeti.

## Önce ne sor

Görevi başlatmadan sor:
1. Pre-commit hook'a eklenecek davranışın spesifik mesajları (Türkçe mi İngilizce mi)?
2. CI tarafında GitHub Actions var mı yoksa sadece Vercel/Railway auto-deploy mi?
3. Test fixture'ları için reel veri PR'ına commit edilecek mi yoksa `.gitignore` ile dışarıda mı?
4. Faz 3'te eski dosya isimleri (`reconciliation.engine.ts`) tamamen silinsin mi yoksa re-export shim olarak bıraksın mı (geriye dönük import'lar kırılmasın diye)?

Kullanıcının cevabını bekle, sonra başla.
