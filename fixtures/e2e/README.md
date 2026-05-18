# E2E Fixture Suite — Pipeline Regression

> Bu klasör **gerçek senaryoları** snapshot olarak kilitler.
> Bir senaryoyu düzeltirken başkasını bozma riski sıfırlanır.

## Klasör yapısı

```
fixtures/e2e/
├── ocr/                  OCR çıktısı tek-modül senaryoları
│   ├── 01-z-raporu/
│   │   ├── input.png         (gerçek belge — eklenecek)
│   │   ├── input.meta.json   (mukellef, donem, belge tipi)
│   │   └── expected.json     (OCR çıktısı snapshot)
│   ├── 02-e-fatura-ubl/
│   ├── 03-okc-fis/
│   ├── 04-makbuz/
│   └── 05-tevkifatli/
│
├── luca/                 Luca Excel parse senaryoları
│   ├── 01-mizan-bilanco/
│   │   ├── input.xlsx        (gerçek Luca export)
│   │   ├── input.meta.json
│   │   └── expected.json     (parse edilmiş satırlar)
│   ├── 02-kdv-alis/
│   ├── 03-kdv-satis/
│   └── 04-e-arsiv/
│
├── reconciliation/       Engine girdi/çıktı senaryoları
│   ├── 01-strict-match/
│   │   ├── input.json        (records[] + images[])
│   │   └── expected.json     (ReconciliationResult[])
│   ├── 02-multi-rate/
│   ├── 03-tevkifat-alis/
│   ├── 04-mukerrer/
│   └── 05-mismatch/
│
└── pipeline/             Uçtan uca: belge → OCR → reconciliation
    ├── 01-petravet-alis-mayis/
    │   ├── inputs/             (belgeler + Luca Excel)
    │   ├── input.meta.json
    │   └── expected.json       (tam reconciliation sonucu)
    ├── 02-edeler-z-raporlu/
    └── 03-silber-tevkifatli/
```

## Çalıştırmak

```bash
# Tüm senaryoları koştur
pnpm test:e2e

# Sadece OCR senaryoları
pnpm test:e2e -- --module=ocr

# Tek senaryo (debug)
pnpm test:e2e -- --scenario=ocr/01-z-raporu
```

Her senaryo iki şekilde başarısız olabilir:
1. **Output expected'dan farklı** → diff gösterir, hangi alanın farklı çıktığını söyler
2. **Çift orphan invariant ihlali** → `detectDoubleOrphans` çağrısı tespit eder

## Yeni senaryo ekleme

1. Gerçek bir bug'ı temsil eden veri al (anonimize et: VKN'leri 1234567890 yap, isim "Test A.Ş." gibi)
2. `fixtures/e2e/<module>/<NN>-<açıklama>/` klasörü aç
3. `input.*` ve `input.meta.json` koy
4. İlk çalıştırma için `expected.json` boş bırak — runner snapshot mode'da oluşturur:
   ```
   pnpm test:e2e -- --update-snapshot --scenario=ocr/06-yeni-senaryo
   ```
5. Üretilen snapshot'ı **gözünle kontrol et** (gerçek bekleneni gösteriyor mu)
6. Commit et — bundan sonra bu senaryo bozulursa CI fail eder

## Anonimleştirme kuralları

Production'dan alınan belgelerde **kişisel bilgi olmamalı**:
- VKN/TCKN → `1234567890` (10 hane) veya `12345678901` (11 hane)
- Mükellef adı → `Test Müşteri A.Ş.` / `Test Tedarikçi Ltd.`
- Telefon → `05551234567`
- Adres → `Test Mahallesi, İstanbul`
- IBAN → `TR000000000000000000000000`

Tarih ve tutarlar orijinal kalabilir (anlam taşımaz).

## Şu an iskelet (gerçek dosya yok)

Aşağıdaki senaryolar **placeholder olarak hazırlandı**. Gerçek belge eklendiğinde
runner direkt çalışmaya başlar.

| Senaryo | Durum | Açıklama |
|---|---|---|
| `ocr/01-z-raporu` | 🔲 boş | Edeler restoran Z raporu örneği |
| `ocr/02-e-fatura-ubl` | 🔲 boş | UBL XML formatı, multi-rate |
| `ocr/03-okc-fis` | 🔲 boş | Migros tab.001 ÖKC fişi |
| `ocr/04-makbuz` | 🔲 boş | Serbest meslek makbuzu |
| `ocr/05-tevkifatli` | 🔲 boş | İnşaat tevkifatlı alış faturası |
| `luca/01-mizan-bilanco` | 🔲 boş | Standart bilanço mizan export |
| `luca/02-kdv-alis` | 🔲 boş | KDV 191 alış |
| `luca/03-kdv-satis` | 🔲 boş | KDV 391 satış |
| `luca/04-e-arsiv` | 🔲 boş | e-Arşiv liste |
| `reconciliation/01-strict-match` | 🔲 boş | Belge no + tarih + KDV birebir |
| `reconciliation/02-multi-rate` | 🔲 boş | %20 + %10 karma fatura |
| `reconciliation/03-tevkifat-alis` | 🔲 boş | Alış 2 Luca satırı + 1 OCR |
| `reconciliation/04-mukerrer` | 🔲 boş | Aynı belge 2 kere yüklenmiş |
| `reconciliation/05-mismatch` | 🔲 boş | Tarih farkı 1 gün, kdv farklı |
| `pipeline/01-petravet-alis-mayis` | 🔲 boş | Mayıs 2026 tam akış — 143 satır |
| `pipeline/02-edeler-z-raporlu` | 🔲 boş | Restoran günlük Z raporu pipeline |
| `pipeline/03-silber-tevkifatli` | 🔲 boş | İnşaat tevkifatlı pipeline |
