# Modul izolasyon sureci

Bu dokumanin amaci, Luca'dan veri ceken modullerde bir degisikligin baska modulu sessizce bozmasini engellemek.

## Uygulanan kalici kurallar

1. Agent runtime tek kaynak
   - Kaynak dosya: `apps/api/public/agent-runtime.js`
   - Web artifact: `apps/web/public/moren-agent.js`
   - Web build/dev oncesi `apps/web/scripts/sync-agent-runtime.js` otomatik kopyalar.
   - `apps/web/public/moren-agent.js` git artifact'i olarak izlenmez.

2. Luca upload endpoint sozlesmesi
   - `MIZAN` sadece `upload-mizan` endpoint'ine gider.
   - `KDV_MIZAN` sadece `upload-kdv-mizan` endpoint'ine gider.
   - `IHO_FETCH` sadece `upload-iho` endpoint'ine gider.
   - `EARSIV_*` ve `EFATURA_*` sadece `upload-earsiv` endpoint'ine gider.
   - KDV kontrol defteri kebir/isletme job'lari sadece `upload-kdv` endpoint'ine gider.
   - Backend her upload'da `jobId`, `tip`, `mukellefId`, `donem` ve gerekli ise `sessionId` sozlesmesini dogrular.
   - Ayni `tenantId + sessionId + mukellefId + donem + tip` icin aktif `pending/running` Luca job'u varken yeni job olusturulmaz; mevcut job'a log eklenip o job dondurulur.
   - Teknik Luca frame/runtime toparlama hatalari sonsuz donguye girmez: retry sayaci, `nextRetryAt` cooldown ve fail-fast kuralindan gecmeden agent'a tekrar verilmez.

3. KDV kontrol veri yenileme kuralı
   - Luca'dan yeni veri geldiginde ayni session'in eski Luca kayitlari ve reconciliation sonuclari once temizlenir, sonra yeni kayitlar yazilir.
   - Reconciliation sonucu tek transaction icinde ve session bazli advisory lock ile yenilenir; ayni session icin iki kontrol ayni anda sonuc satiri cogaltamaz.

4. Regression zorunlulugu
   - `pnpm test:regression` KDV eslestirme icin gercek hata senaryolarini kosar.
   - Su an pinlenen senaryolar:
     - 0622: iki KDV satiri tek fis toplaminda eslesir.
     - 0647: 8,33 + 654,55 = 662,88 olarak tek belgeye eslesir.
     - GKN038: 500 + 1220 = 1720 olarak tek e-faturaya eslesir.
     - AKG097: belge no/tarih ayni olsa bile 60 ile 1220 tam eslesmez.
     - Z raporu 694: oran kirilimi korunur, toplam da eslesir.
     - Ayni tarih/tutar ama farkli e-fatura no/satici review/unmatched kalir.

5. Modul guard
   - `pnpm guard:modules` su kontrolleri yapar:
     - Agent source/artifact hash ayni mi?
     - Agent artifact staged eklenmis mi?
     - Kritik panel route'lari duruyor mu?
     - KDV reconciliation helper parcalari duruyor mu?
     - Luca endpoint/job tipi sozlesmesi bozulmus mu?
     - Local Luca service onarim scriptleri tasinabilir mi?

6. Smoke sirasi
   - Her kritik degisiklikten sonra:
     - `pnpm test:smoke`
     - `pnpm --filter @mali-musavir/api build`
     - `pnpm --filter @mali-musavir/web build`
   - API davranisi degistiyse Railway deploy.
   - Portal/UI/agent artifact degistiyse Vercel production deploy.
   - Deploy sonrasi:
     - Portal route HTTP 200 kontrolu
     - API runtime hash kontrolu
     - Portal `moren-agent.js` hash kontrolu

## Bundan sonraki geliştirme kuralı

Bir modüle dokunulacaksa değişiklik şu sırayla yapılır:

1. Önce mevcut davranışı fixture/regression olarak kilitle.
2. Sonra sadece ilgili modül dosyasında değişiklik yap.
3. Luca runtime'a dokunulduysa `agent-runtime.js` dışında artifact editlenmez.
4. Upload endpoint veya job tipi değişirse hem runtime hem backend contract güncellenir.
5. `pnpm test:smoke` yeşil olmadan canlıya çıkılmaz.
6. Canlıya çıktıktan sonra hash ve route kontrolü yapılır.

## Kalan büyük işler

1. `ocr.service.ts` parcalanacak:
   - provider: Azure/Claude/UBL
   - parser: Z raporu, OKC fis, e-fatura, tarih, belge no, tutar
   - validation: review ve matematik kontrolleri

2. `reconciliation.engine.ts` daha da parcalanacak:
   - strict match
   - fuzzy match
   - score calculator
   - seller check

3. OCR fixture'lari eklenecek:
   - cok oranli Z raporu
   - OKC fis
   - e-fatura XML/PDF
   - OIV/KDV karisimi olan faturalar

4. Luca local agent servis kurulumu her PC'de `scripts\onar-servis.bat` ile yenilenecek.
