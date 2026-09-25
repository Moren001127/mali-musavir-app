# Şema değişikliği isteyen dört kalem — plan

**Tarih:** 25 Eylül 2026
**Durum: DÖRDÜ DE UYGULANDI VE CANLIDA.** Aşağısı kayıt için duruyor.

| # | Konu | Commit | Canlı doğrulama |
|---|---|---|---|
| 46b | Aşama damgası | `123ffdd` | 4/4 sütun eklendi, 340 satır DEĞİŞMEDİ |
| 36b | Sürümde dosya türü | `a0f7578` | 2/2 sütun eklendi |
| 32b | Kişi bazlı okundu | `2946005` | `notification_reads` tablosu var, 6.436 bildirim değişmedi |
| 35b | Kalan `take` sınırları | `fefc8a1`, `69ad262` | 90.215 belge üzerinde koşturuldu |

**Hiçbirinde geri dolum yapılmadı** — plandaki gerekçelerle. Üç göç de EKLEMELİ
(`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`); tek bir mevcut satır bile
değişmedi, canlı sayımlarla doğrulandı.

**35b planlandığından FARKLI yapıldı — gerekçesi:** Plan üçünü de
`{ rows, total, page, pageSize }` biçimine geçirmeyi ve bunu "ORTA risk" saymayı
öngörüyordu. İki şey bunu değiştirdi:
1. Repo sözleşmesi (§4) sayfalamayı **isteğe bağlı** kılıyor: `page` verilmezse eski dizi
   yanıtı aynen döner. Yani tüketen ekranları kırma riski yok.
2. **Canlı ölçüm** önceliği tersine çevirdi: belgelerde 90.215'e karşı 100 sınırı bugün
   doluyor, görevlerde 19/500 ve sohbette 4/80 dolmuyor. Bu yüzden belgeler tam çözüldü
   (sunucuda süzme + gerçek sayaçlar + sayfalama), görev ve sohbette yanıt biçimi
   değiştirilmedi; yalnız **sessiz kırpma** kaldırıldı (`kirpildi`, `dahaEskisiVar`).

**Ayrıca 35b sırasında bulunan, planda OLMAYAN kusurlar** (hepsinin kökü aynı: Evrak
ekranı şemada bulunmayan alan adlarını okuyordu) — ayrıntısı `fefc8a1` commit'inde:
kart başlığı hep "Belge" çıkıyordu, başlıkta arama hiç çalışmıyordu, "OCR Edilmiş" sayacı
hep %0'dı ve OCR süzgeci seçilince liste her zaman boş kalıyordu, üç tür kutucuğu hiçbir
zaman sonuç vermiyordu.

---

**Neden ayrı tur (özgün gerekçe):** Dördü de veritabanı şeması değiştiriyor. Kod değişikliği
geri alınabilir, şema değişikliği + geri dolum alınamaz.

---

## Özet tablo

| # | Konu | Şema değişikliği | Geri dolum | Risk | Öncelik |
|---|---|---|---|---|---|
| 32b | Kullanıcı bazlı "okundu" | YENİ TABLO | gerekmez | düşük | orta |
| 36b | Belge sürümünde dosya türü | 2 nullable sütun | kısmi (uzantıdan) | çok düşük | düşük |
| 46b | Aşama başına zaman damgası | 4 nullable sütun | YAPILAMAZ | düşük | **yüksek** |
| 35b | Kalan `take` sınırları | YOK (sayfalama) | gerekmez | orta | orta |

---

## 32b — Ofis geneli bildirimde kullanıcı bazlı "okundu"

**Bugünkü durum:** `Notification.isRead` **tek alan**. Ofis geneline gönderilen bir bildirimi
biri açınca **herkes için** okundu oluyor; diğer personel o bildirimi hiç görmüyor.

**Değişiklik:**
```prisma
model NotificationRead {
  id             String   @id @default(cuid())
  notificationId String
  userId         String
  readAt         DateTime @default(now())

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([notificationId, userId])
  @@index([userId, readAt])
  @@map("notification_reads")
}
```

**Okuma kuralı:** `userId` dolu bildirim → eski `isRead` (kişiye özel, davranış değişmez).
`userId` boş (ofis geneli) bildirim → `NotificationRead` satırı var mı.

**Geri dolum:** GEREKMEZ. `isRead` alanı duruyor; kişiye özel bildirimlerde kullanılmaya
devam eder. Ofis geneli eski bildirimler için "okundu" bilgisi zaten kişi bazında YOK —
onlar herkese okunmamış görünür. Bu bir kereye mahsus gürültü yaratır.

**Dikkat:** Okunmamış SAYAÇLARI (`/notifications/unread-count`, `unread-summary`,
`KritikUyariStatCard`) bu tabloya göre yeniden yazılmalı; yoksa sayaç ile liste ayrışır.

**Risk:** Düşük. Yeni tablo, mevcut sütun bozulmuyor. Geri alma: tabloyu bırak, okuma
kuralını eski hâle döndür.

---

## 36b — `DocumentVersion` dosya türü ve özgün ad

**Bugünkü durum:** Şemada `mimeType` ve özgün dosya adı **yok**. 25 Eylül'de yapılan
düzeltme türü sürümün **nesne anahtarı uzantısından** çıkarıyor — uzantısız anahtarlarda
güncel belgenin türüne düşüyor.

**Değişiklik:**
```prisma
model DocumentVersion {
  // ... mevcut alanlar
  mimeType     String?   // yükleme anındaki gerçek tür
  originalName String?   // kullanıcının yüklediği dosya adı
}
```

**Yazan yerler (dördü de güncellenmeli):** `documents.service.ts:101`, `:353`,
`portal-automation.service.ts:3087`, `whatsapp-bot.controller.ts:906`,
`whatsapp.controller.ts:726`.

**Geri dolum:** Eski satırlarda gerçek tür bilinmiyor. En fazla uzantıdan türetilebilir —
bu da zaten çalışma anında yapılıyor. **Geri dolum yapılmasın**; `null` kalan satırlarda
mevcut (uzantı tabanlı) davranış sürsün.

**Risk:** Çok düşük. İki nullable sütun.

---

## 46b — Aşama başına zaman damgası (EN YÜKSEK ÖNCELİK)

**Bugünkü durum:** `TaxpayerMonthlyStatus`'ta **tek** aşama damgası var:
`evraklarIslendiAt`. Şemanın kendi notu durumu söylüyor:
> *"updatedAt kullanılamaz: başka alan güncellenince tazelenir."*

25 Eylül düzeltmesi bekleme süresini aşamaya göre ayırdı ama iki aşamada hâlâ `updatedAt`
kullanılıyor — yani **oralarda gecikme hâlâ sıfırlanabiliyor**.

**Değişiklik:**
```prisma
model TaxpayerMonthlyStatus {
  // ... mevcut alanlar
  evraklarGeldiAt    DateTime?
  yuklendiAt         DateTime?
  kontrolEdildiAt    DateTime?
  beyannameVerildiAt DateTime?
}
```

**Yazma kuralı:** İlgili bayrak `false → true` olduğunda damga yazılır; `true → false`
olduğunda **null**'a çekilir (bkz. bulgu 49'daki `onayTarihi` dersi — geri alınan durumda
eski damga kalırsa raporlar onu gerçek sanıyor).

**Geri dolum: YAPILAMAZ.** Geçmiş geçişlerin ne zaman olduğu hiçbir yerde tutulmuyor.
Eski kayıtlarda damgalar `null` kalır ve bugünkü `updatedAt` yedeği kullanılmaya devam eder.
**Uydurma tarih yazılmamalı** — yanlış gecikme, hiç gecikme göstermemekten kötüdür.

**Risk:** Düşük (dört nullable sütun). Asıl iş yazma yollarını bulmak:
`taxpayers.service.ts` ve `is-akisi` tarafında bayrakları güncelleyen HER yol.

---

## 35b — Kalan `take` sınırları

**Bugünkü durum (25 Eylül'de ele alınmadı):**

| Yer | Sınır | Sorun |
|---|---|---|
| `documents.service.ts:250` | `take: 100` | sayfalama yok, toplam yok, uyarı yok |
| `tasks.service.ts:464` | `take: 500` | aynı |
| `office-chat:115` | `take: 80` | aynı |

Bunlarda süzme **bellekte değil**, kırpma doğrudan listenin kendisinde — yani bulgu 35'in
mükellef belgelerindeki "sessizce kaybolma" deseni değil, klasik sayfalama eksikliği.
Yine de kullanıcı 101'inci belgeyi hiç göremiyor ve bunu ANLAMIYOR.

**Değişiklik: ŞEMA DEĞİŞİKLİĞİ YOK.** Üç uç de `{ rows, total, page, pageSize }`
sözleşmesine geçirilir (repoda zaten var: `beyan-sayfa.ts`, `genel-sorgular.listele`).
Ekranlar sayfalama denetimi kazanır.

**Risk:** ORTA — bu üç ucun yanıt biçimi değişiyor; her tüketen ekran güncellenmeli.
Bu yüzden diğer üçünden **ayrı** ele alınmalı.

---

## Önerilen sıra

1. **46b** — en yüksek değer: iş yükü gecikmeleri gerçek olur. Geri dolum yok, risk düşük.
2. **32b** — personel bildirim kaçırmayı bırakır. Sayaçların da güncellenmesi şart.
3. **36b** — küçük, temiz.
4. **35b** — en geniş yüzey; kendi turunda.

Her adımdan sonra: `pnpm test:regression` + `npx jest --runInBand` + iki tsc, sonra
canlıya alma onayı.
