# Moren Portal — Entegre Otomasyon Planı

**Hedef:** Mihsap arşivinden fatura görüntüleri + Luca muavinleri otomatik çekilsin, Claude OCR ile tek kaynakta okunsun, KDV kontrolü tek tuşla yapılsın.

**Başlangıç:** Yarın
**Tahmini süre:** 2-3 çalışma günü

---

## 1. Veri Mimarisi

```
┌──────────────┐   JPEG indir        ┌──────────┐   Claude OCR   ┌──────────┐
│ Mihsap Arşiv │ ──────────────────▶ │  Portal  │ ─────────────▶ │ Invoice  │
└──────────────┘                      │ Storage  │                 │   DB     │
                                      └──────────┘                 └──────────┘
                                                                        ▲
                                                                        │
┌──────────────┐   Excel export                              ┌──────────────┐
│     Luca     │ ──────────────────▶ parse ────────────────▶ │ LucaRecord DB │
└──────────────┘                                              └──────────────┘
                                                                        │
                                                                        ▼
                                                              ┌──────────────┐
                                                              │ KDV Kontrol  │
                                                              │  (tek tuş)   │
                                                              └──────────────┘
```

**Prensip:** Mihsap'ın kendi ham verisine güvenme. Tek doğru kaynak **fatura görüntüsü**. Claude Haiku 4.5 görüntüden okur.

---

## 2. Yeni DB Tabloları

### Invoice
```prisma
model Invoice {
  id            String   @id @default(cuid())
  tenantId      String
  taxpayerId    String
  donem         String   // "2026-03"
  tip           String   // "ALIS" | "SATIS"
  kaynak        String   // "MIHSAP_ARSIV" | "LUCA_EARSIV" | "MANUEL"

  // Kimlik
  mihsapId      String?  @unique  // duplicate engelleme
  lucaId        String?
  imageUrl      String?  // portal storage path
  imageThumb    String?

  // Claude OCR ile çıkarılan alanlar
  belgeNo       String?
  belgeTuru     String?  // "E_FATURA" | "FIS" | "E_ARSIV"
  faturaTarihi  DateTime?
  satici        String?
  saticiVkn     String?
  matrah        Decimal? @db.Decimal(15,2)
  kdvOrani      Int?
  kdvTutari     Decimal? @db.Decimal(15,2)
  toplamTutar   Decimal? @db.Decimal(15,2)

  // Anlamlandırma
  kategori      String?  // "yakit" | "yemek" | "ulasim" | "konaklama" | "demirbas" | "kirtasiye" | "diger"
  indirilebilir Boolean? // KDV indirilebilir mi
  icerikOzet    String?  // 1-2 satır ürün özeti
  ocrGuven      Float?
  ocrRawJson    Json?    // Claude'un tam cevabı (denetim için)

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([tenantId, taxpayerId, donem])
  @@index([tenantId, donem, tip])
}
```

### LucaRecord
```prisma
model LucaRecord {
  id          String   @id @default(cuid())
  tenantId    String
  taxpayerId  String
  donem       String
  tip         String   // "KDV_191" | "KDV_391" | "GELIR" | "GIDER"

  tarih       DateTime?
  belgeNo     String?
  aciklama    String?
  matrah      Decimal? @db.Decimal(15,2)
  kdvTutari   Decimal? @db.Decimal(15,2)
  toplamTutar Decimal? @db.Decimal(15,2)
  hesapKodu   String?
  karsiFirma  String?

  sourceFile  String?  // yüklenen excel dosya adı
  sourceHash  String   // mükerrer engelleme
  rowIndex    Int?

  createdAt   DateTime @default(now())

  @@index([tenantId, taxpayerId, donem, tip])
  @@unique([tenantId, sourceHash])
}
```

### KdvRunResult (tek tuş kontrolün çıktısı)
```prisma
model KdvRunResult {
  id           String   @id @default(cuid())
  tenantId     String
  taxpayerId   String
  donem        String
  tip          String   // "ALIS_191" | "SATIS_391"

  matchStatus  String   // "MATCHED" | "PARTIAL" | "LUCA_ONLY" | "INVOICE_ONLY" | "CONFLICT"
  invoiceId    String?
  lucaRecordId String?
  matchScore   Float?
  anomaliler   Json?    // ["belge_no_farki", "tutar_farki_%2", "tarih_gun_farki"]

  aksiyon      String?  // kullanıcı onaylar: "KABUL" | "RED" | "REVIZE"
  not          String?
  createdAt    DateTime @default(now())
}
```

---

## 3. Yeni Ajanlar

### 3.1 Mihsap Arşiv Çekici (`mihsap-arsiv` action)

**Script eklemesi:** `apps/web/public/moren-agent.js`

**İş akışı:**
1. Mihsap'ta mükellefin arşiv listesine git (yeni URL keşfi gerekir)
2. Her belge satırı için:
   - Detay sayfasını aç (editör)
   - Editördeki canvas/img → JPEG çek
   - Portal API'ye gönder: `POST /invoices/ingest`
     - `taxpayerId`, `donem`, `tip`, `mihsapId`, `imageBase64`
   - Backend: görseli Railway volume'a kaydet, Claude'a gönder, OCR sonucu ile DB'ye yaz
3. Komut sonucu: "X fatura çekildi, Y Claude ile okundu"

**Runner side:** browser'da SPA navigation ile belge belge gezip JPEG toplama.

### 3.2 Luca Muavin Çekici (`luca-muavin` action)

**Script:** yeni `apps/web/public/luca-agent.js` (bookmarklet ile)

**Önce keşif gerekir:**
- Luca domain (`muhasebe.luca.com.tr` / `app.luca.com.tr` / başka?)
- 191/391 muavin hangi menüde? Dönem nasıl seçiliyor?
- Excel export butonu var mı, yoksa tablo scrape mi?

**İş akışı:**
1. Luca muavin sayfasına git (kullanıcı manuel açar veya runner URL'e git)
2. Mükellef + dönem seçildiğinden emin ol
3. Excel export butonuna bas → blob indirilir
4. Blob'u portal'a gönder: `POST /luca-records/upload` with `{ tip, donem, taxpayerId, file }`
5. Backend: excel parse et, `LucaRecord` tablosuna toplu insert (hash ile duplicate engelle)

### 3.3 Portaldan komut akışı

Mükellef detay sayfasına (`/panel/mukellefler/[id]`) 2 buton:

```
┌─────────────────────┐  ┌─────────────────────┐
│ 📄 Mihsap Fatura    │  │ 📊 Luca Muavin      │
│    Çek              │  │    Çek              │
└─────────────────────┘  └─────────────────────┘
```

Her buton:
- Dönem seçici modal aç (mart 2026 vs)
- Alış/Satış (Mihsap için) veya tip seçimi (Luca: 191/391/gelir/gider)
- `POST /agent/commands` ile ajan kuyruğuna bırak
- Runner bookmarklet açıksa otomatik çalıştır

---

## 4. Faturalar Paneli Yenileme

**Yeni sayfa:** `/panel/faturalar` — tamamen yeniden

```
┌─────────────────────────────────────────────────┐
│  Dönem: [Mart 2026 ▾]  Tip: [Hepsi ▾]  [Filtre]│
├─────────────────────────────────────────────────┤
│  YORGUN NAKLİYAT ▸ 87 fatura                    │
│  ┌──┬──┬──┬──┬──┬──┬──┐                        │
│  │📄│📄│📄│📄│📄│📄│📄│  ← thumbnail grid      │
│  └──┴──┴──┴──┴──┴──┴──┘                        │
│  Toplam KDV: 12.450 TL · Matrah: 62.250 TL      │
├─────────────────────────────────────────────────┤
│  ÖZ ELA TURİZM ▸ 143 fatura                     │
│  ...                                            │
└─────────────────────────────────────────────────┘
```

- Thumbnail tıklanınca büyük preview modal
- OCR detayları (tarih, belgeNo, matrah, KDV, kategori) yanında görünsün
- Anomali olan faturalar (düşük güven, KDV indirilemiyor) kırmızı çerçeve
- **İndir**: seçili faturaları zip olarak indirme
- **Düzenle**: OCR yanlışsa manuel düzeltme

---

## 5. KDV Kontrol — Tek Tuş

**Yeni akış:** `/panel/kdv-kontrol/yeni`

```
┌────────────────────────────────────────┐
│ 🎯 KDV Kontrol Oturumu                 │
│                                        │
│ Mükellef: [YORGUN NAKLİYAT ▾]         │
│ Dönem:    [Mart 2026 ▾]               │
│ Kontrol:  [✓ 191  ✓ 391]              │
│                                        │
│ Kaynaklar:                             │
│   📄 Mihsap faturaları: 87 mevcut     │
│   📊 Luca 191 muavin:   92 mevcut     │
│   ✨ Hepsi hazır                       │
│                                        │
│ [🚀 Kontrolü Başlat]                  │
└────────────────────────────────────────┘
```

**Backend mantığı:**
1. Invoice'ları çek (donem + tip=ALIS)
2. LucaRecord'ları çek (donem + tip=KDV_191)
3. Eşleştirme algoritması:
   - Belge no birebir → MATCHED (yüksek güven)
   - Belge no yakın + tarih+tutar uyuyor → MATCHED
   - Tarih+tutar uyuyor ama belge no farklı → PARTIAL
   - Sadece Invoice'da var → `INVOICE_ONLY` (Luca'ya işlenmemiş)
   - Sadece Luca'da var → `LUCA_ONLY` (Mihsap'ta görsel yok)
   - Tutar %5+ fark → `CONFLICT`
4. `KdvRunResult` tablosuna yaz

**Sonuç ekranı:**
```
┌─────────────────────────────────────────────┐
│ Sonuç: 76 eşleşti · 8 kısmi · 3 eksik · 2 fark│
├─────────────────────────────────────────────┤
│ [Eşleşti] [Kısmi] [Eksik] [Fark] [Hepsi]   │
│                                             │
│ ✓ E152026000005355  📄➜📊  3200 TL  MATCH  │
│ ⚠ AVP2026000071896  📄➜📊  2609 TL  tarih  │
│ ✗ BEY2026000029125  📄    386 TL Luca'da yok│
│ ✗                  📊  450 TL Mihsap'ta yok │
└─────────────────────────────────────────────┘
```

**Çıktılar:**
- **Excel rapor** — 4 sheet (Eşleşti / Kısmi / Eksik-Luca / Eksik-Mihsap)
- **PDF rapor** — görsel önizlemelerle denetim kanıtı
- **KDV özet**: Toplam matrah, hesaplanan KDV, indirilecek KDV, devreden/ödenecek

---

## 5.5 Fiş Yazdırma — DB'den Otomatik Bonus

**Fikir:** Mihsap arşivinden gelen JPEG'ler zaten `Invoice` DB'sine kaydediliyor. ÖKC fişi / e-fatura ayrımı **belge no uzunluğundan** yapılabilir:

| Belge türü | Belge no örnek | Uzunluk |
|------------|----------------|---------|
| E-Fatura | `E152026000005355` | 16 hane |
| E-Arşiv | `EAR2026000000439` | 16 hane |
| ÖKC Fiş (yazar kasa) | `0014`, `0316` | 3-6 hane |

**Yeni akış (fiş yazdırma):**

```
┌──────────────────────────────────┐
│ 🖨️  Fiş Yazdırma                 │
│                                  │
│ Mükellef: [YORGUN NAKLİYAT ▾]   │
│ Dönem:    [Mart 2026 ▾]         │
│                                  │
│ Kaynak: ◉ DB'deki fişler        │
│          ○ Manuel görsel yükle   │
│                                  │
│ Tespit edilen ÖKC fişi: 34 adet │
│ (belge no ≤ 6 hane, tarih var)  │
│                                  │
│ Sayfa/Fiş: (4) 8 (12)           │
│                                  │
│ [🎯 Word Oluştur]               │
└──────────────────────────────────┘
```

**Backend mantığı:**
1. `Invoice.where({ taxpayerId, donem, tip: 'ALIS' })`
2. Filter: `belgeNo.length <= 6` OR `belgeTuru === 'FIS'`
3. Claude zaten tarihleri okumuş → direkt sırala, Word'e bas
4. Kullanıcı tek satır bile yazmaya gerek kalmaz

**Kazançlar:**
- Fiş yazdırma için ayrı görsel yükleme gereksiz (Mihsap'tan bir kez çekilen yeter)
- OCR tek sefer yapılır, tekrar tekrar tarih okutulmaz
- Mühtevi artırıldı: aynı görsel **hem KDV kontrolde hem fiş yazdırmada** kullanılıyor
- Manuel yükleme fallback olarak kalacak (eski fotoğrafları için)

**UI değişikliği:** Fiş yazdırma sayfasında üstte "Kaynak" seçici:
- **DB'deki fişler** (default) → mükellef+dönem seç → Word oluştur
- **Manuel görsel yükle** → mevcut akış (fotoğraflardan)

Kod tarafında:
- `GET /fis-yazdirma/from-db?taxpayerId=X&donem=2026-03` → `Invoice` filtresi → `generateWord()` aynı servis çağrılır
- `generateWord` artık iki kaynaktan da çalışır: ya `Express.Multer.File[]` ya `Invoice[]` (içinde `imageUrl`)

---

## 6. Storage

**Railway volume** kullan (en basit, ücretsiz):
- `/data/invoices/{tenantId}/{taxpayerId}/{donem}/{invoiceId}.jpg`
- Thumbnail: `/data/invoices/{...}/{invoiceId}_thumb.jpg` (240px wide)
- Railway volume fiyatı: $0.25/GB/ay (10k fatura ≈ 2GB = $0.5/ay)

**Alternatif:** DB'de base64 — KÖTÜ fikir (DB şişer). Kullanmıyoruz.

---

## 7. Maliyet Tahmini

**Tek bir mükellef için 1 ay (100 fatura):**
- Claude Haiku OCR: 100 × $0.003 = **$0.30**
- KDV kontrol eşleştirme: hesap, $0
- Storage: 200 MB × $0.25/GB = **$0.05**
- **Toplam: ~$0.35/mükellef/ay**

**Ofis bütünü (154 mükellef × $0.35):** **~$55/ay**

---

## 8. Uygulama Sırası

| # | Adım | Süre | Çıktı |
|---|------|------|-------|
| 1 | Prisma migration (Invoice + LucaRecord + KdvRunResult) | 30 dk | DB hazır |
| 2 | Invoice ingest endpoint (image upload + Claude OCR) | 1.5 s | Görselden fatura kaydı |
| 3 | Mihsap Arşiv action (`mihsap-arsiv`) — script + backend | 2 s | Mükellef ay'ını Mihsap'tan çekme |
| 4 | Faturalar paneli (thumbnail grid + filtre + modal) | 1.5 s | `/panel/faturalar` yeni UI |
| 5 | Luca keşif + luca-agent.js runner | 1 s | Luca DOM/URL belirleme |
| 6 | Luca muavin çekici action (`luca-muavin`) | 2 s | Excel parse + DB insert |
| 7 | Mükellef sayfasına 2 buton | 30 dk | "Çek" akışı açık |
| 8 | KDV Kontrol yeni akış (`/kdv-kontrol/yeni`) | 1.5 s | Tek-tuş kontrol |
| 9 | Eşleştirme algoritması v2 | 1 s | MATCHED/PARTIAL/CONFLICT üret |
| 10 | Sonuç ekranı + Excel/PDF rapor | 1.5 s | Denetçiye teslim |
| 11 | Fiş yazdırma'ya "DB'den" kaynak seçeneği + ÖKC filtresi | 45 dk | Fiş için görsel yüklemeye gerek yok |

**Toplam:** 13-15 saat tahmini (2-3 iş günü)

---

## 9. Yarın Başlamadan Önce Hazırlık

**Senden:**
- [ ] **Luca URL'i:** tam adres (login olduğun sayfa)
- [ ] **Luca muavin ekranından screenshot** — menü + export butonunun yeri
- [ ] **Mihsap "arşiv"** nerede? Muhtemelen `/documents` altında ama "arşiv" ayrı sekme mi? Ekran görüntüsü
- [ ] Railway'de **volume mount** açık mı? (API servisinde Storage sekmesi)

**Benden:**
- [ ] İlk PR ile schema + migration
- [ ] Dev ortamda Claude ingest endpoint'ini tek fatura ile test
- [ ] Mihsap arşiv DOM keşfi (senin hesapla canlıda bakmam gerekir)

---

## 10. Riskler

| Risk | Önlem |
|------|-------|
| Luca SPA scrape zorlaşır (anti-bot) | Excel export butonu varsa güvenli; yoksa Tampermonkey ile manuel |
| Mihsap arşivinden toplu indirme rate-limit yer | 1 saniye delay, max 5 paralel |
| Claude Haiku rare fatura tipinde yanılır | Kullanıcı manuel düzeltir; rare vakalar için Sonnet seçeneği |
| Railway volume dolar | Aylık eskiyi otomatik arşivle (3 ay sonrası zip + indirilebilir) |
| KDV tutar eşleştirme'de ondalık farkı | Tolerans parametresi (varsayılan %1) + manuel override |

---

## 11. Başarı Kriterleri

- [ ] Tek tuşla bir mükellefin ay'lık faturaları Mihsap'tan çekilsin (max 10 dk için 100 fatura)
- [ ] Luca 191 muavini tek tuşla DB'ye yüklensin
- [ ] KDV Kontrol sayfasından **hiçbir dosya yüklemeden** sonuç gelsin
- [ ] %85+ otomatik MATCHED oranı
- [ ] Hata/eksik kayıtlar net açıklamayla listelensin
- [ ] Denetçiye Excel + PDF rapor verilebilsin
- [ ] Fiş yazdırma mükellef+dönem seçimiyle hiç görsel yüklemeden Word oluştursun

---

**Hazır. Yarın "start" dediğinde Adım 1'den başlarım.**

---

## 12. İlave Fırsatlar (Sonra Yapılabilir)

Ana mimari kurulduktan sonra, **aynı Invoice + LucaRecord verisini kullanarak** kolayca eklenebilecekler:

### A. Mükellef Self-Servis Portalı 🏢
- Her mükellefe **kendi login'i** (ayrı rol: `CLIENT`)
- Kendi faturalarını, KDV özetini, beyannamelerini görsün
- Belge yükleme (yeni vekaletname, sözleşme vs.)
- Mesajlaşma: "Bu fatura eksik, bilgi lazım"
- Soru-cevap: "Bu ay KDV ne kadar çıkar?"
- **Kazanç:** telefonla sorulan soruların %70'i düşer

### B. WhatsApp / SMS Hatırlatma Ajanı 📱
- Dönem sonlarında **otomatik hatırlatma**:
  - "15 Nisan — KDV beyanname son gün"
  - "Bu ay tahakkuk eden KDV: 12.540 TL"
  - "İmza beklediğimiz belgeler var"
- WhatsApp Business API entegrasyonu (zaten `whatsapp` modülü var, gerçekleşmemiş)
- Mükellef bazlı frekans ayarı

### C. Akıllı Chat Asistan (Portal Içinde) 💬
- Sağ altta **Moren AI** chat widget
- Çalışanlar sorsun:
  - "YORGUN NAKLİYAT'ın Mart KDV'si ne kadar?"
  - "Bu fatura hangi hesaba gider?"
  - "Geçen ay en çok atlanan fatura tipi neydi?"
- Claude agent + portal DB + muhasebe bilgi tabanı
- **Kazanç:** küçük sorulara yanıt için rapor çıkarmaya gerek kalmaz

### D. BA-BS Mutabakat Ajanı 🤝
- Aylık BA-BS formlarını **karşı firmalarla mutabakat** için hazırla
- Otomatik e-posta/WhatsApp gönderimi: "Şu firma ile Mart BA mutabakatı: 45.000 TL. Onaylar mısınız?"
- Gelen yanıtları takip et, çelişenleri işaretle
- **Kazanç:** el ile mutabakat mesajı atmayı bırak

### E. Banka Ekstresi OCR + Cari Eşleştirme 🏦
- PDF banka ekstresi yükle
- Claude satırları okur → tarih, tutar, açıklama
- Otomatik cari hesaba düş: "Bu 12.000 TL ŞEKERCİ PETROL → 320.01.XXX"
- Kullanıcı onaylar → Luca'ya aktarılır
- **Kazanç:** ay sonu cari dökümü hazırlama saatlerden dakikalara

### F. Tam Otomatik Beyanname Taslak Üretici 📋
- KDV kontrol tamamlandıktan sonra **KDV1 / KDV2 beyannamesini Claude doldursun**
- GİB XML formatında çıktı (e-beyanname yüklenebilir format)
- Değişiklikleri işaretle: "Bu ayki matrah önceki aylara göre %35 yüksek, kontrol et"
- **Kazanç:** beyanname hazırlama süresi 2 saatten 10 dakikaya

### G. Denetim Logu / Audit Trail 🔍
- Her kullanıcı aksiyonu DB'ye yaz: kim, ne zaman, neyi değiştirdi
- Kritik olaylar: komut çalıştırma, fatura silme, rapor indirme
- Ekran: `/panel/ayarlar/denetim`
- **Kazanç:** mali denetim / çalışan sorumluluğu

### H. Maliyet ve Ücret Takibi 💰
- Her mükellef için **işlem sayaçları** (bu ay kaç fatura işlendi, kaç Claude çağrısı yapıldı)
- Mükellef başı ücret / yapılan iş karşılaştırması
- Karlılık raporu: hangi mükellef kar ediyor, hangisi zarar
- **Kazanç:** fiyatlandırma kararları için veri

### I. Evrak Yenileme Uyarısı 📅
- Her mükellef için belge kayıtları: vekaletname, imza sirküleri, ticaret sicil
- Yenilenme tarihi yaklaşanlar dashboard'da uyar
- Eksik belgeler listesi
- **Kazanç:** "geçen yılki vekaletnamenin süresi dolmuş" sürprizi bitiyor

### J. Akıllı Fatura İçerik Arama 🔎
- Tüm Invoice'larda **full-text arama**: "Mart'ta tüm motorin faturaları", "ŞEKERCİ PETROL'e ödenen toplam"
- Claude'un çıkardığı `icerikOzet` alanında keyword index
- Eski fatura bulma dakika yerine saniyeler
- **Kazanç:** "şu firmanın faturasını bul" dedikçe kopyala-yapıştır biter

### K. Mükellef Benchmark Raporu 📊
- Aynı sektördeki mükellefleri anonim olarak karşılaştır
- "YORGUN NAKLİYAT'ın yakıt gider oranı sektör ortalamasının %8 üstünde"
- Claude ile anormal sapma tespiti
- **Kazanç:** mali müşavirin danışmanlık değeri artar

### L. Mobil Uygulama 📱
- Sadece **fiş fotoğrafı çekme** için mükellefler kullanır
- Çekilen fiş direkt portal'a düşer + Claude OCR + ilgili mükellefe kaydolur
- Kaybolan fiş sorunu biter
- **Kazanç:** mükellefin fiş toplama işi otomatikleşir

---

## 13. Önceliklendirme Matrisi

| Fırsat | Zorluk | Değer | Öncelik |
|--------|--------|-------|---------|
| B. WhatsApp Hatırlatma | Düşük | Yüksek | ⭐⭐⭐ İlk |
| J. Fatura İçerik Arama | Düşük | Yüksek | ⭐⭐⭐ İlk |
| C. Chat Asistan | Orta | Yüksek | ⭐⭐⭐ İlk |
| F. Beyanname Taslak | Orta | Çok Yüksek | ⭐⭐⭐ İlk |
| E. Banka OCR | Orta | Yüksek | ⭐⭐ İkinci |
| D. BA-BS Mutabakat | Orta | Orta | ⭐⭐ İkinci |
| A. Mükellef Portalı | Yüksek | Yüksek | ⭐⭐ İkinci |
| G. Audit Log | Düşük | Orta | ⭐ Üçüncü |
| H. Ücret Takibi | Düşük | Orta | ⭐ Üçüncü |
| I. Evrak Yenileme | Düşük | Orta | ⭐ Üçüncü |
| K. Benchmark | Yüksek | Orta | Sonra |
| L. Mobil Uygulama | Yüksek | Orta | Sonra |

**İlk 4 fırsat** (B, J, C, F) ana Invoice + LucaRecord mimarisinin doğal devamı. Ana iş bittikten sonra sırayla eklenebilir.

---

## 14. Mobil Uygulama Stratejisi 📱

**Soru:** Portalde olan her şey mobilde olsun — en verimli yol nedir?

### Seçenek Karşılaştırması

| Yaklaşım | Kod Çoğaltma | Geliştirme | Özellik Paritesi | Öneri |
|----------|---------------|------------|------------------|-------|
| **PWA (Next.js)** | **Yok** — aynı kod | ~1 hafta | %95 | ⭐⭐⭐ |
| **PWA + Capacitor** | Minimum | ~2 hafta | %100 | ⭐⭐⭐ **En İyi** |
| React Native (Expo) | Yeni codebase | 2-3 ay | %100 | Pahalı |
| Flutter | Yeni codebase | 2-3 ay | %100 | Pahalı |

### Önerilen Mimari: PWA + Capacitor

```
┌─────────────────────────────────────────────┐
│          Tek Next.js Kod Tabanı             │
│    (portal.morenmusavirlik.com)             │
├─────────────────────────────────────────────┤
│                                             │
│   ┌────────┐        ┌────────────────┐     │
│   │ Tarayıcı│        │ Capacitor Shell│     │
│   │  (PWA) │        │  (iOS/Android) │     │
│   └────────┘        └────────────────┘     │
│       │                    │               │
│       └────────┬───────────┘               │
│                ▼                           │
│       Aynı sayfa, aynı bileşenler          │
└─────────────────────────────────────────────┘
```

**Katmanlar:**
1. **PWA katmanı** (Next.js içinde): Service Worker, manifest.json, offline cache — `portal.morenmusavirlik.com` "Ana ekrana ekle" ile telefona yüklenir
2. **Capacitor shell** (App Store / Play Store için): PWA'yı native binary'ye saran wrapper. Native özelliklere erişim verir (kamera, biyometri, push bildirim, dosya sistemi)

### Mobil-Özel Özellikler

Normal portal özelliklerinin tümü otomatik çalışır (responsive tasarım yapılıyor zaten). Ekstra mobil optimizasyonlar:

| Özellik | Mobil Kullanım |
|---------|----------------|
| 📷 **Fiş Fotoğrafı Çek** | Capacitor Camera API — native kamera ile fiş çek, direkt yükle |
| 🔔 **Push Bildirim** | Yeni komut tamamlandı, KDV hatırlatması, tebligat geldi |
| 🔐 **Biyometri (FaceID/Touch)** | Hızlı login, hassas aksiyonlar için onay |
| 📴 **Offline Mod** | Son görülen faturalar, mükellef listesi cache'de |
| 📎 **Dosya Paylaşımı** | Telefondan gelen WhatsApp PDF'lerini portal'a "Share" ile at |
| 📍 **Konum Etiketleme** | Fiş çekerken nerede çekildiği (denetim için) |
| 📊 **Dashboard Widget** | iOS/Android home screen'de "Bu ay KDV", "Bekleyen komutlar" |

### Kullanım Senaryoları

**Mükellef (client rolü) — mobil ağırlıklı:**
- Fiş çeker → anında portal'a düşer
- Push bildirim: "Mart KDV'niz hazır, 12.540 TL — onaylar mısınız?"
- Soru gönderir: "Bu faturayı işler misiniz?"
- Belgelerini görür, indirir

**Personel (staff/admin) — her yerden erişim:**
- Ofisin dışındayken komut çalıştırır
- Telefondan fatura inceler, düzeltme yapar
- WhatsApp üzerinden gelen belgeleri "Paylaş → Moren" ile direkt yükler
- Push ile ajan durum takibi

### Uygulama Sırası

| # | Adım | Süre | Çıktı |
|---|------|------|-------|
| 1 | Next.js'e PWA ekle (manifest + service worker) | 2 s | `portal.morenmusavirlik.com` "Ana ekrana ekle" ile yüklenir |
| 2 | Mobil responsive tasarım optimizasyonu | 1 g | Küçük ekranlarda düzgün görünüm |
| 3 | Kamera entegrasyonu (Web API) | 3 s | Tarayıcıdan fiş fotoğrafı çekme |
| 4 | Capacitor kur, iOS + Android build | 1 g | TestFlight + Play Store Internal Testing |
| 5 | Push bildirim (Firebase FCM) | 1 g | Komut tamamlandı bildirimleri |
| 6 | Biyometri + güvenli depolama | 4 s | FaceID ile login |
| 7 | App Store + Play Store submission | 1 h (review süresi) | Yayında |

**Toplam süre:** ~1 hafta (aktif kodlama) + 1-2 hafta (store review)

### Maliyet

- **Apple Developer:** $99/yıl (zorunlu)
- **Google Play Developer:** $25 bir kez
- **Firebase push bildirim:** ücretsiz (yüksek hacim için ücret)
- **Geliştirme eforu:** 1 hafta (tek kişi)
- **Süregelen:** portal'a özellik eklediğinde mobilde otomatik görünür, **ayrı mobil geliştirme gereksiz**

### Neden PWA + Capacitor?

1. **Tek kod tabanı** — portalde ne yazarsan mobilde de olur
2. **Anlık yayın** — portal'a push ederken mobilde de güncellenir (App Store güncellemesi beklemez, çünkü HTML/JS web'den gelir)
3. **Native özellikler korunur** — kamera, push, biyometri, offline
4. **Düşük maliyet** — React Native / Flutter'da ayrı codebase ≈ $30-50K iş; bu yolda ~$3-5K
5. **Bakım kolaylığı** — tek geliştirici yönetir

### Risk

- **App Store politikası:** Apple "Hybrid App"leri kabul ediyor ama native hissiyat bekliyor. Capacitor buna uygun yazılmış, problem olmaz.
- **Offline veri sync'i:** Portal DB-only çalışıyor, offline değişiklikler sync için ekstra mantık gerekir (ileride).

---

## 15. Revize Edilmiş Büyük Resim

```
                    ┌────────────────────────────────┐
                    │        Moren Platform          │
                    │  (Next.js + Prisma + Claude)   │
                    └──────────┬─────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
    🖥️  Portal            📱 PWA                📱 Native App
    (Ofis PC)          (Her tarayıcı)         (iOS + Android)
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                               │
                               ▼
             ┌──────────────────────────────────┐
             │  Aynı özellikler her yerde:      │
             │  • KDV Kontrol (tek tuş)        │
             │  • Fatura arşivi + görseller    │
             │  • Mihsap + Luca ajanları       │
             │  • Fiş yazdırma                 │
             │  • Chat asistan                 │
             │  • Beyanname taslak             │
             │  • WhatsApp hatırlatma          │
             └──────────────────────────────────┘
```

**Anafikir:** Mobil uygulama ayrı bir ürün değil, portal'ın "taşınabilir penceresi". Bu sayede mimari temiz, bakım basit, maliyet düşük kalır.
