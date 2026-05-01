# Sabah Çalıştır — Gece Yapılan Değişiklikler

**Hazırlayan:** Moren AI gece çalışması · 1 Mayıs 2026
**Durum:** Kod hazır, sandbox push'a izin vermediği için commit/push elle yapılacak.

---

## 1. Adım — Git lock'u sil ve commit'le

PowerShell'de:

```powershell
cd C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app

# Sandbox'tan kalan lock dosyasını temizle
Remove-Item .git\HEAD.lock -Force -ErrorAction SilentlyContinue
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue

# Ne değişti gör
git status

# README zaten ben commit etmeyi denerken oldu (91323b0) — sonrası elle:
git add -A
git commit -m "feat: gece çalışması — audit log, evrak yenileme, e-arşiv ZIP yükleme, bildirimler polish, mükellef karlılık özeti"
git push origin main
```

Push tamamlanınca Railway otomatik deploy başlar.

---

## 2. Adım — Veritabanı migration'ı

Yeni bir migration eklendi (`20260501000000_document_expiry`). **Bu non-breaking** — sadece optional alanlar:

```sql
ALTER TABLE "documents"
  ADD COLUMN "expiresAt"     TIMESTAMP(3),
  ADD COLUMN "reminderDays"  INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "notes"         TEXT;
```

### Yerel geliştirme:
```powershell
cd apps/api
pnpm prisma migrate dev
pnpm prisma generate
```

### Production (Railway):
Otomatik — Dockerfile'daki `prisma migrate deploy` komutu yeni migration'ı çalıştırır.

---

## 3. Adım — Frontend cache temizle

Shared paket schema'sı değişti (UpdateDocumentSchema'ya yeni alanlar). Web tarafının yeniden derlenmesi gerek:

```powershell
# Yerel:
cd ../web
pnpm dev   # otomatik HMR

# Veya tam temizlik:
rm -rf .next
pnpm dev
```

Production: Vercel otomatik build edecek.

---

## 4. Adım — Yeni özellikleri test et

### A) Audit Log (Denetim Günlüğü)
- URL: `/panel/ayarlar/denetim`
- Sidebar: **Sistem → Denetim Günlüğü**
- ADMIN rolü gerekli
- Filtre: tarih, kullanıcı, kaynak, aksiyon
- Mini chart: son 30 gün aksiyon sayısı

### B) Evrak Yenileme
- URL: `/panel/evraklar/yenileme`
- Sidebar: **Sistem → Evrak Yenileme**
- Liste: süresi bitmiş + 30/60/90/180/365 gün içinde bitecek
- Inline edit modal: tarih, hatırlatma günü, not
- Mükellef detayında widget olarak da görünür (90 gün horizon)

**Veri yok mu?** Doğal — şu anki belgelerde `expiresAt` boş. Mükellef detayından evraklara
girip "Düzenle" ile son kullanım tarihi girilebilir.

### C) Bildirimler
- URL: `/panel/bildirimler` — yeni dark theme
- "Tümünü okundu işaretle" butonu (üst sağda)
- Filtre: Tümü / Okunmamış + tip dropdown'u

### D) E-Arşiv
- URL: `/panel/e-arsiv`
- Yeni: **ZIP Yükle** butonu — Luca'dan elle indirdiğin ZIP'i portala yükle
- Yeni: Job log container — agent ilerlemesi canlı görünür

### E) Mükellef Karlılık Özet Kartı
- Mükellef detay sayfasının üstünde
- Son 1/3/6/12 ay seçilebilir
- Sayaç grid: KDV session, Mihsap fatura, E-arşiv, Fiş görüntü, Mizan, Beyanname, Evrak, AI çağrısı
- Cari kasa bakiyesi (tahakkuk - tahsilat)
- Moren AI maliyeti (USD)

---

## 5. Bilinen Notlar

- **AI çağrıları**: `AiUsageLog` tablosunda `taxpayerId` alanı yok — eşleşme `mukellef` (string) alanına göre yapılıyor. Mükellef adında değişiklik olduysa eski kayıtlar görünmez. İleride `taxpayerId` eklemek değerli.

- **Cari Kasa Bakiyesi**: TAHAKKUK pozitif, TAHSILAT/IADE/DUZELTME negatif olarak hesaplanıyor. Pozitif bakiye = mükellefin borcu var. Mantığı doğrulamak iyi olur.

- **Audit interceptor**: Şu anda `oldData`/`newData` yazmıyor (sadece action+resource). İleride değer farkı kaydı için interceptor genişletilebilir.

- **Dashboard widget**: `DocumentExpiryWidget` standalone component. Dashboard'a (`/panel`) eklemedim çünkü o sayfa 1118 satır + dokunmak riskli. İstersen elle import edersin.

---

## 6. Geceyi Tamamlayamayanlar

Şu maddeler gece riskli olduğu için yapılmadı (sözünü tutmak için):
- **E-Defter Denetim modülü** — sıfırdan, 2-3 hafta tahmini, MVP spec netleşmeli
- **Bordro/SGK modülü** — Faz 4, haftalar
- **Mobil uygulama** — PWA + Capacitor, 1 hafta
- **Beyanname taslak üretici** — KDV1/KDV2 → GİB XML
- **Banka OCR** — banka ekstresi PDF okuma
- **BA-BS mutabakat**
- **Müşteri portalı**

Bu maddeler için ayrı oturumda spec-driven çalışmak gerek.

---

## 7. Tek seferlik komut (özet)

Yukarıdaki tüm adımları tek paragrafta:

```powershell
cd C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app
Remove-Item .git\HEAD.lock,.git\index.lock -Force -ErrorAction SilentlyContinue
git add -A
git commit -m "feat: gece çalışması — audit log, evrak yenileme, e-arşiv ZIP yükleme, bildirimler polish, mükellef karlılık özeti"
git push origin main
cd apps/api
pnpm prisma migrate dev
pnpm prisma generate
cd ../..
pnpm dev   # geliştirme sunucusu
```

---

**Hayırlı sabahlar.**
