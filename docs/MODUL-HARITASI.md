# Modül Haritası — "Neye dokunursam ne kırılır?"

> Bu doküman bir modüle dokunmadan ÖNCE bakılır. Hangi modül hangisini etkiliyor,
> hangi shape'ler arasında geçiyor, kritik kontrat hangi sözleşme dosyasında —
> hepsi burada.
>
> **Kural:** bir PR mümkün olduğunca tek modüle dokunmalı. Birden fazla modülü
> birlikte değiştirmek = ayrı PR.

---

## Üst seviye akış

```
┌──────────────────────────────────────────────────────────────────┐
│                       PORTAL (apps/web)                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Fatura   │  │ KDV Kontrol  │  │  Mizan   │  │ Beyanname    │ │
│  │ İşleme   │  │  ⚠ KİLİTLİ   │  │ ⚠ KİLİTLİ│  │              │ │
│  └────┬─────┘  └──────┬───────┘  └────┬─────┘  └──────┬───────┘ │
└───────┼───────────────┼────────────────┼────────────────┼───────┘
        │               │                │                │
        └───────────────┴────────────────┴────────────────┘
                                │
                                ▼
        ┌──────────────────────────────────────────────────┐
        │   apps/api  —  NestJS Backend                    │
        │                                                  │
        │  ┌─────────┐ ┌──────────────┐ ┌──────────────┐  │
        │  │  OCR    │ │ Reconciliat. │ │ Luca Local   │  │
        │  │ Service │ │   Engine     │ │   Agent      │  │
        │  └────┬────┘ └──────┬───────┘ └──────┬───────┘  │
        │       │             │                │          │
        │       └─────────────┴────────────────┘          │
        │              │ contracts (Zod)                  │
        └──────────────┼──────────────────────────────────┘
                       ▼
        ┌──────────────────────────────────────────────────┐
        │  packages/shared/src/contracts/  (Zod schemas)   │
        │  • ocr.contract.ts          (OcrResultSchema)    │
        │  • luca.contract.ts         (LucaJobUpload...)   │
        │  • reconciliation.contract.ts (Status, Result)   │
        └──────────────────────────────────────────────────┘
```

---

## Modül-bazlı "neye dokunursam ne kırılır" tablosu

### 1. OCR (`apps/api/src/kdv-control/ocr.service.ts` + `ocr/`)

| Eğer dokunursam… | Bunlar kırılabilir | Yapmam gereken |
|---|---|---|
| `OcrResult` shape (alan ekle/sil/tip değiştir) | reconciliation engine, faturalar listesi, OCR review panel | `packages/shared/src/contracts/ocr.contract.ts` güncelle, sonra `pnpm test:contracts` koş |
| Belge tipi tespiti (fiş vs fatura vs Z raporu) | reconciliation skoring, vendor match | `scripts/ocr-tax-regression.cjs` koş; gerekirse pinli senaryo ekle |
| KDV oran/tutar parser | tüm KDV kontrolü | `scripts/ocr-tax-regression.cjs` (WASH faturası gibi senaryolar pinli) |
| Azure/Claude provider yapısı | OCR servisi tek başına | (yan etki yok, ama performans/maliyet değişebilir) |
| `kdvBreakdown` shape | multi-rate eşleştirme | `kdv-reconciliation-regression.cjs` 0622, 0647 senaryoları |

### 2. Reconciliation (`apps/api/src/kdv-control/reconciliation.engine.ts` + `reconciliation/`)

| Eğer dokunursam… | Bunlar kırılabilir | Yapmam gereken |
|---|---|---|
| `calculateScore` ağırlıkları | Tüm KDV eşleştirme | `kdv-reconciliation-regression.cjs` |
| Strict match koşulu (PASS 1) | "Tarih+belge no+KDV birebir eşleşmiş ama 'unmatched' yazıldı" tip bug | Pinli senaryolarla doğrula + double-orphan invariant (`detectDoubleOrphans`) çalıştır |
| `MIN_PAIR_SCORE` (PASS 2 eşik) | Gevşek eşleşme oranı | Pinli senaryo: 0622, 0647, AKG097 |
| `fanOutMatch` davranışı | Multi-rate fatura aynı imageId'ye fan-out olur | `kdv-reconciliation-regression.cjs` |
| `ReconciliationResult` shape | Export Excel, KDV kontrol UI | `packages/shared/src/contracts/reconciliation.contract.ts` güncelle |
| `aggregateMultiRateRecords` | Z raporu, karma KDV oranlı faturalar | Z694 senaryo + multi-rate test |

### 3. Export (`apps/api/src/kdv-control/kdv-control.service.ts` → `exportResultsToExcel`)

| Eğer dokunursam… | Bunlar kırılabilir | Yapmam gereken |
|---|---|---|
| Status -> kategori eşleme | Excel'deki "matched/review/error" grupları yanlış sayım | `RECONCILIATION_STATUS_CATEGORY` sabit; değiştirme |
| `compareKdvExportRows` sıralama | Sıralama drift, aynı belge ayrı yerlerde | `kdv-export-order-regression.cjs` |
| Sayaç hesapları (`matchedCount`, `unmatchedCount`) | Özet bloğu yanlış | Status enum kullan, hardcode "MATCHED" string yazma |
| Fan-out / sumUniqueImageKdv | Multi-rate KDV toplamı çift sayılır | Pinli senaryo |

### 4. Luca Local Agent (`apps/api/public/agent-runtime.js` + `apps/web/public/moren-agent.js`)

⚠ **TEK KAYNAK:** `apps/api/public/agent-runtime.js`. Web tarafındaki `moren-agent.js`
build/dev sırasında `apps/web/scripts/sync-agent-runtime.js` ile kopyalanır.
`apps/web/public/moren-agent.js` .gitignore'da olmalı (henüz değil — Faz 6 işlemi).

| Eğer dokunursam… | Bunlar kırılabilir | Yapmam gereken |
|---|---|---|
| Frame mesaj formatı | Backend upload endpoint'leri | `scripts/luca-upload-contract-regression.cjs` |
| Job tipi seti | Tüm Luca akışları (mizan, kdv, e-arşiv) | `LucaJobTipiSchema` (`packages/shared/src/contracts/luca.contract.ts`) güncelle |
| Endpoint URL | Backend `app.module.ts` ile çakışır | `LUCA_JOB_TO_ENDPOINT` sabit; backend rotaları da güncelle |
| Servis kurulum script'i | Yerel agent başlatma | `install-service.ps1` / `uninstall-service.ps1` test et |

### 5. Backend Luca service (`apps/api/src/luca/luca.service.ts`)

| Eğer dokunursam… | Bunlar kırılabilir | Yapmam gereken |
|---|---|---|
| Job state machine | Tüm Luca akışları | `scripts/luca-upload-contract-regression.cjs` |
| `cancel-when-failed` davranışı | Frontend "stuck job" durumu | Manuel: hata fırlatan job → UI takılmamalı |
| Session replace mantığı | Yeni Luca çekimi gelince eski temizleniyor | `scripts/kdv-session-replace-contract.cjs` |

### 6. Kilitli Modüller — Mizan & KDV Kontrol Panelleri

⚠ **Kullanıcı onayı OLMADAN değiştirilemez.** `KILITLI_MODULLER.md` listesi:

- `apps/web/src/app/(panel)/panel/mizan/page.tsx`
- `apps/api/src/mizan/` (tüm klasör)
- `apps/web/src/app/(panel)/panel/kdv-kontrol/page.tsx`
- `apps/api/src/kdv-control/` (tüm klasör — ama IÇERIDEKI parçalama buna dahil değil, sadece public API)

Bypass: `MOREN_UNLOCK=1 git commit ...` (acil durum için).

---

## Sözleşme dosyaları ve nereden okunduğu

| Sözleşme dosyası | Üreten modül | Tüketen modüller |
|---|---|---|
| `ocr.contract.ts → OcrResult` | OCR service | reconciliation engine, KDV review panel, faturalar listesi |
| `luca.contract.ts → LucaJobUpload` | Luca local agent | Backend upload controller'ları, agent runtime |
| `luca.contract.ts → LucaRow` | KDV control service (Excel parse) | Reconciliation engine, KDV review UI |
| `reconciliation.contract.ts → ReconciliationResult` | Reconciliation engine | Export Excel, KDV review UI, badge counter'lar |
| `reconciliation.contract.ts → ReconciliationStatus` | Engine + export + UI hepsinde paylaşılır | Tüm KDV UI/render kodu |

---

## Bir bug bulduğunda hangi sıraya bakacaksın?

1. **Çift orphan / unmatched bug:** Önce `detectDoubleOrphans()` ile DB'ye bak.
   İhlal varsa engine PASS 1/2 koşulu yanlış. İhlal yoksa export render bug'ı.

2. **OCR yanlış okuyor:** `apps/api/src/kdv-control/ocr/` parser dosyalarına bak.
   `ocr.service.ts`'in 3871 satırlık ana dosyası parçalanıyor (Faz 1).

3. **Aynı belge iki kere matched yazılmış:** `fanOutMatch` mantığını incele;
   muhtemelen aynı record_id farklı virtualGroup'a iki kere düşmüş.

4. **Luca'dan veri gelmiyor:** Önce frontend → backend HTTP, sonra
   `apps/api/src/luca/luca.service.ts` job state, sonra agent runtime.

5. **Excel'de saymalar yanlış:** `RECONCILIATION_STATUS_CATEGORY` sabitini kullan,
   `'MATCHED'` veya `'UNMATCHED'` gibi string'leri hardcoded yazma.

---

## Faz roadmap referansı

| Faz | Durum | Açıklama |
|---|---|---|
| **0. Sözleşme katmanı** | ✅ Tamam | Zod schemas (Faz 0'da eklendi) |
| **1. OCR parçalama** | 🔄 Devam | `ocr.service.ts` 3871 → ≤400 satır/dosya |
| **2. Reconciliation parçalama** | 🔄 Devam | `reconciliation.engine.ts` 1112 → ≤400 |
| **3. Luca çekme katmanı** | 🔄 Devam | Agent + filter + service için kontrat |
| **4. E2E fixture suite** | ⏳ Bekliyor | 20 gerçek senaryo snapshot |
| **5. Pre-commit + CI duvarı** | ✅ Tamam | Husky + GitHub Actions |
| **6. Modül sahipliği + diyagram** | ✅ Tamam | Bu doküman + CODEOWNERS |
