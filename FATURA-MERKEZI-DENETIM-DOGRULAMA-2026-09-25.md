# Fatura Merkezi denetimi — bulguların koddan doğrulanması

**Tarih:** 25 Eylül 2026
**Kaynak:** `FATURA-MERKEZI-DENETIM-2026-09-25.md` (Codex denetimi, 15 bulgu)
**Yöntem:** Her bulgu ilgili kaynak dosyadan tek tek okundu. Kod değiştirilmedi. Doğrulama 5 ayrı incelemeye bölündü; satır numaraları bu belgenin yazıldığı andaki kaynağa aittir.
**Kod sürümü:** Yerel dal `origin/main` ile birebir aynı (fark 0). Yani denetim canlıya giden kaynağın kendi sürümü üzerinde yapıldı — denetim raporundaki "canlı sürüm aynı mı" çekincesi geçersiz.

---

## Karar özeti

| # | Bulgu | Karar |
|---|---|---|
| 1 | Aktarılmış belge yeniden kuyruğa girebiliyor | **DOĞRULANDI** |
| 2 | Eşzamanlı toplu aktarımda aynı belge iki içerikte | **DOĞRULANDI** |
| 3 | Fatura işlemlerinde rol/mükellef sınırı eksik | **KISMEN DOĞRU** |
| 4 | Aynı numaralı farklı faturalar karışıyor | **DOĞRULANDI** |
| 5 | İki mükellefin aynı ETTN'li belgesi karışıyor | **KISMEN DOĞRU** |
| 6 | Sınırdan sonra dönem süzmesi eski belgeleri atıyor | **DOĞRULANDI** |
| 7 | Genel Bakış toplamı tekil belge sayısı değil | **DOĞRULANDI** (+ ek bulgu) |
| 8 | Üst mükellef/dönem seçimi bazı ekranlarda ölü | **DOĞRULANDI** |
| 9 | KDV uyuşmazlığına rağmen kesin sonuç gösteriliyor | **DOĞRULANDI** |
| 10 | Liste kayıt sınırı belgeleri görünmez bırakıyor | **DOĞRULANDI** |
| 11 | Liste açmak hesap kodlarını siliyor | **DOĞRULANDI** (iddiadan geniş) |
| 12 | Bağlantı hatası boş sonuç gibi görünüyor | **KISMEN DOĞRU** |
| 13 | Tek belge yeniden denemesi ortak işi bozuyor | **DOĞRULANDI** |
| 14 | Aktarım başarısı ve hesap açılışı güvencesi eksik | (a) **DOĞRULANDI** / (b) **KISMEN DOĞRU** |
| 15 | Tarihsiz belgede dönem kuralı tutarsız | **DOĞRULANDI** (üç ayrı kural var) |

**11 doğrulandı, 4 kısmen doğru, hiçbiri tamamen yanlış değil.** İki bulgunun (3 ve 5) birer alt iddiası yanlış; aşağıda ayrıca yazıldı.

---

# BÖLÜM A — Çift kayıt

## Bulgu 1 — Aktarılmış belge yeniden kuyruğa girebiliyor → DOĞRULANDI

**Kanıt.** `apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts`

`approve()` (7939) belgenin mevcut `lucaStatus`'una hiç bakmıyor. Satır 8036-8046:

```ts
await this.prisma.invoiceAccountingDocument.update({
  where: { id },
  data: {
    status: 'APPROVED', approvedBy: userId || null, approvedAt: new Date(),
    lucaStatus: elleYolu ? 'MANUAL_DONE' : doc.taxpayerId ? 'QUEUED' : 'NOT_STARTED',
    // ← POSTED / POSTING kontrolü yok
```

`retryLucaPost()` (9172) kapıları: `status !== 'APPROVED'`, mükellef yok, `MANUAL_DONE`, `lucaElleYolu`. **`POSTED` kapısı yok.** Satır 9199-9202 belgeyi zorla geri açıyor:

```ts
data: { lucaStatus: 'FAILED', lucaJobId: null, lucaErrorMessage: null },
```

Ardından 9204'te `batchPostToLuca(..., { documentIds: [id] })`; oradaki süzgeç `lucaStatus: { in: ['QUEUED','FAILED','NOT_STARTED'] }` (9124) → belge yeniden gidiyor.

Aynı korumayı `remove()` (9216) ve `reopen()` (8204) **yapıyor** — yani kalıp projede var, bu iki fonksiyonda atlanmış.

**Etki.** Luca'da fişi kesilmiş belge ikinci kez fişe girer. Tetikleyici yol: iş `FAILED` işaretlenir ama Excel Luca'ya yüklenmiştir → ön yüzde "tekrar dene" düğmesi çıkar → aynı fatura ikinci fişe düşer. Portalda uyarı çıkmaz.

**Bulguyu sınırlayan mevcut koruma.** `approveBatch` (8084-8087) `status === 'APPROVED'` olanı atlıyor → toplu onay yolu kapalı. Ön yüzde tekrar-dene düğmesi yalnız `FAILED/ERROR` durumunda görünüyor (`apps/web/src/app/fatura-merkezi/page.tsx:5461`). Açık kalan yol: tekil `approve` uç noktası + gerçekte aktarılmış ama yanlış `FAILED` işaretlenmiş belge.

**Çözüm.** `approve()` ve `retryLucaPost()` başına tek kapı: `['POSTED','POSTING'].includes(doc.lucaStatus)` ise `BadRequestException` ("önce geri al"). Ek olarak `approve()`'daki güncelleme `updateMany` + `where: { id, lucaStatus: { notIn: ['POSTED','POSTING'] } }` olsun ki yarış durumunda da tutsun.

---

## Bulgu 13 — Tek belge yeniden denemesi ortak işi bozuyor → DOĞRULANDI

Bu bölümün en kesin kanıtı burada.

**Kanıt.** `retryLucaPost` 9189-9202:

```ts
if (doc.lucaJobId) {
  await this.prisma.lucaFetchJob.updateMany({
    where: { id: doc.lucaJobId, status: { in: ['pending','running'] } },
    data: { status: 'failed', errorMsg: 'Tekrar deneme icin iptal edildi', finishedAt: new Date() },
  });
}
await this.prisma.invoiceAccountingDocument.updateMany({
  where: { id, tenantId },            // ← yalnız bu belge; kardeşler POSTING'de kalıyor
  data: { lucaStatus: 'FAILED', lucaJobId: null, ... },
});
```

Aktarım aracı **yalnız `cancelled` durumunda duruyor**, `failed` diye durmuyor — `apps/api/public/agent-runtime.js:2300`:

```js
if (j && j.status === 'cancelled') { window.__morenAgent.stopRequested = true; ... }
```

Dahası, araç işi bitirdiğinde `markJobDone` (`apps/api/src/luca/luca.service.ts:548`) işi `status: { notIn: ['cancelled'] }` koşuluyla güncellediği için **"failed" işi tekrar "done"a çeviriyor.**

**Etki.** Eski iş Luca'ya tam listeyi (ortak fişi) yazar; yeniden denenen belge aynı anda yeni işte ikinci kez yazılır → o belge Luca'da iki fişte görünür. Kardeş belgeler ise `failed` işe bakılarak `FAILED`'a çekilir (`posting-serbest-birak.ts`) — oysa gerçekte aktarılmışlardır → kullanıcı "tekrar dene" derse onlar da ikinci kez düşer.

**Mevcut koruma.** `POSTING` nöbetçisi (2026-09-23'te eklenmiş) belgeleri sonsuza kadar kilitli bırakmıyor. Yani "belirsiz kalır" kısmı kısmen çözülmüş; ama kararı yanlış yönde ("aktarılmadı") veriyor.

**Çözüm.**
1. `retryLucaPost` ortak işe dokunmasın: iş `running` ise reddet ("aktarım sürüyor, bitmesini bekle").
2. Gerekiyorsa `markJobFailed` yerine `cancelJob` kullan (araç yalnız buna uyuyor) ve aracın durduğunu teyit et.
3. `markJobDone`'daki iş güncellemesine `status: { notIn: ['cancelled','failed'] }` koy ki ölü iş dirilmesin.
4. Ortak işten çıkarılan belgede kardeşleri de aynı işlemde `FAILED` yap.

---

## Bulgu 14 — Aktarım başarısı ve hesap açılışı güvencesi

### (a) Başarı doğrulaması yok → DOĞRULANDI

**Kanıt.** `apps/api/src/luca/luca.service.ts:540-573` beklenen sayı ile gelen sayıyı hiç karşılaştırmıyor:

```ts
const nextRecordCount = Number.isFinite(recordCount) && recordCount > 0 ? recordCount : (current?.recordCount || 0);
...
await this.prisma.invoiceAccountingDocument.updateMany({
  where: { OR: orWhere },       // ← lucaJobId'ye bağlı TÜM belgeler
  data: { lucaStatus: 'POSTED', lucaPostedAt: new Date(), ...(extra?.fisNo ? { lucaFisNo: extra.fisNo } : {}) },
});
```

Araç tarafında daha net — `apps/api/public/agent-runtime.js:4714-4723`:

```js
let fisBasari = false;
if (!islemTakipAcik()) { /* ...başarı metni ara... */ }
await fetch(API + `/agent/luca/jobs/${job.id}/done`, {      // ← fisBasari'ya BAKMADAN "done"
  body: JSON.stringify({ recordCount: p.totalCount || 0 }), // ← beklenen sayı geri yankılanıyor
});
```

`fisBasari` yalnız günlük metnini ve durum yazısını değiştiriyor; işin sonucunu değiştirmiyor. Ayrıca `extra.fisNo` hiçbir çağırıcı tarafından gönderilmiyor (tek çağrı `luca.controller.ts:640` → `markJobDone(id, body.recordCount ?? 0)`), yani **`lucaFisNo` her zaman boş** — arşivdeki fiş no sütunu ve `reopen()` teyit kutusu hep "—" gösterir, aktarılan fişin izi kalmaz.

**Bulguyu güçlendiren asimetri.** İŞLETME (CSV) dalı doğruluyor — `agent-runtime.js:4412/4426`: `if (ok) → done`, değilse `throw`. Yani açık olan yalnız BİLANÇO/Excel dalı. Bu, genel bir eksiklik değil, hedefli bir boşluk.

**Etki.** Luca 200 satır tavanını aştığında ya da "Fiş Kes" onayı gelmediğinde belgeler yine "Aktarıldı" olur. Portal "gitti" der, Luca'da fiş yok ya da kısmen var. Fiş numarası kaydedilmediği için mutabakat da yapılamaz.

**Çözüm.** (1) Araç `fisBasari` yanlışsa `/fail` çağırsın (işletme dalıyla aynı). (2) `markJobDone` içinde beklenen `totalCount` ile gelen sayı karşılaştırılsın; eşit değilse belgeler `POSTED` yapılmasın, `FAILED` + "Luca'da teyit et" yazılsın. (3) Araç fiş numarasını okuyup `{ fisNo }` ile göndersin; fiş no boşken en azından uyarı düşsün.

### (b) Hesap açma işine bağlı değil → KISMEN DOĞRU

**Kanıt.** `fatura-muhasebelestirme.service.ts:9097-9102` hatayı yutuyor, fiş işi yine kuruluyor:

```ts
try { await this.pushAccountPlanToLuca(tenantId, { taxpayerId: body.taxpayerId, createdBy: userId }); }
catch (e: any) { this.logger.warn(`Auto hesap-açma atlandı: ${e?.message || e}`); }
```

Sunucu sıralaması da hesap işini öne almıyor: `luca.service.ts:1267` `orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]`; `INVOICE_POST` `priority: 5`, `ACCOUNT_PLAN_PUSH` önceliksiz (`schema.prisma:2149` → `priority Int @default(0)`). Yani sunucu **fiş işini öne koyuyor**.

**Neden "kısmen".** Araç listeyi kendi tarafında yeniden sıralıyor — `agent-runtime.js:2076` hesap işini öne alıyor. Bu çoğu zaman kurtarıyor. Ama yalnız tek yoklamada gelen en çok 5 işi sıralar ve hesap işi başarısız olursa fiş işi yine çalışır.

**Etki.** Luca'da olmayan cari/hesap koduyla fiş kesilir; o satırlar reddedilir veya atlanır — (a) ile birleşince belge "Aktarıldı" görünür ama fişte yoktur.

**Çözüm.** `ACCOUNT_PLAN_PUSH`'a `priority: 6` ver (fişin 5'inden yüksek) — araç sıralamasına güvenme. Fiş işini hesap işi bitince serbest kalacak şekilde bağla (ör. `blockedByJobId`), ya da en azından hesap işi `failed` ise fiş işini kurma ve kullanıcıya hata dön.

---

## Bulgu 2 — Eşzamanlı toplu aktarımda aynı belge iki içerikte → DOĞRULANDI

**Kanıt.** `batchPostToLuca` içinde sıra ters: iş içeriği önce yazılıyor, belgeler sonra kapatılıyor.

```ts
9109:  const job = await this.prisma.lucaFetchJob.create({ data: { ...
9131:    invoices: g.docs.map(toInvoicePayload),   // ← içerik: kilitlenmemiş g.docs'un TAMAMI
9139:  const claim = await this.prisma.invoiceAccountingDocument.updateMany({
9140:    where: { id: { in: g.docs.map(d => d.id) }, lucaStatus: { in: ['QUEUED','FAILED','NOT_STARTED'] } },
9142:    data: { lucaStatus: 'POSTING', lucaJobId: job.id, ... },
9148:  if (!claim || claim.count === 0) {        // ← yalnız "sıfır" denetlenmiş; kısmi kapma sessiz
```

`$transaction` yok, satır kilidi yok, `lucaJobId` üzerinde tekillik kısıtı yok (`schema.prisma:2598` düz `String?`).

**Etki.** A işi 1-2-3'ü kapar; B işi 1-2-3-4 içeriğiyle oluşmuş, kapmada yalnız 4'ü alır → `count=1`, sıfır olmadığı için devam eder. B'nin Excel'i 1-2-3-4 satırlarını taşır → 1, 2, 3 Luca'ya ikinci kez düşer. `markJobDone` bu belgeleri `lucaJobId`'ye göre eşlediği için ikinci kayıt portalda hiç görünmez. Aynı mükellefte işler sıraya alınıyor (`claimJob` içindeki `runningSameMukellef`) ama bu yalnız geciktirir, bayat içeriği temizlemez.

**Çözüm.** Kapmayı içerikten önce yap: boş iş kaydı oluştur → `updateMany` ile kapat → kapılan kimlikleri geri oku (`findMany({ where: { lucaJobId: job.id } })`) → içeriği yalnız o belgelerle güncelle. Ya da üçünü tek `$transaction` içine al ve `claim.count !== g.docs.length` ise içeriği daralt.

---

# BÖLÜM B — Veri karışması

## Temel tespit: veritabanı hiç korumuyor

`apps/api/prisma/schema.prisma:2550-2622` → `InvoiceAccountingDocument` (belge tablosu):

- **Tek bir `@@unique` yok.** Yalnız `@id`.
- **`ettn` kolonu hiç yok.** ETTN ya `sourceRefId` (düz metin, tekil değil) ya `ocrData.ettn` (JSON içi).

Yani mükerrer/karışma koruması tamamen kodun `WHERE` şartlarına bağlı. Bulgu 4 ve 5'in ciddiyeti buradan geliyor.

Aynı şemada **doğru yapılmış** iki örnek var ve ikisinin yorumu bu ofiste yaşanmış olayları anlatıyor:

- `EarsivFatura` (2990): `@@unique([tenantId, taxpayerId, tip, belgeKaynak, faturaNo, saticiVergiNo])` — yorum: *"canlı bulgu 2026-08-20 — YORGUN NAKLİYAT Temmuz: Luca'da 30, portalda 25 fatura. GİB belge numarası KÜRESEL BENZERSİZ DEĞİLDİR… GIB2026000000083 hem FEDAT AYDOĞDU hem EFE NAKLİYAT'ta… 5 çift = 5 kayıp fatura."*
- `EFaturaInbox` (3636): `@@unique([tenantId, taxpayerId, entegrator, uuid])` — yorum: *"aynı UUID birden çok mükellefte çekilebilir… ikinci mükellefin faturası P2002 alıp sessizce atlanıyordu."*

**Yani Bulgu 4 ve 5, bu ofiste zaten yaşanmış ve iki tabloda çözülmüş bir hatanın üçüncü yerde açık kalmış hâlidir.** Varsayım değil.

---

## Bulgu 4 — Aynı numaralı farklı faturalar karışıyor → DOĞRULANDI

**En ağır bulgu: tek geri alınamaz zarar burada.**

**Kanıt.** `fatura-muhasebelestirme.service.ts`, `importEfaturaInboxToAccounting` (6056).

Arama sorgusu — 6137-6142:

```ts
const belgeNos = [...new Set(rows.map(r => String(r.faturaNo || '').trim()).filter(Boolean))];
const byNoDocs = await prisma.invoiceAccountingDocument.findMany({
  where: { tenantId, taxpayerId: opts.taxpayerId, belgeNo: { in: belgeNos } },
```

`WHERE` alanlarının tamamı: `tenantId` + `taxpayerId` + `belgeNo`. **Satıcı VKN yok, yön yok, ETTN yok, tarih yok, tutar yok.**

Anahtar yalnız belge numarası — 6118: `existingDocsByBelgeNo.set(doc.belgeNo.trim().toUpperCase(), doc)`. Aynı numaralı iki belge varsa **son okunan kazanıyor**.

ETTN eşleşmesi tutmazsa bu haritaya düşülüyor — 6238-6239:

```ts
const existingBySourceRef = existingDocsBySourceRef.get(`${providerSource(row)}::${sourceRef}`)
  || (row.faturaNo ? existingDocsByBelgeNo.get(String(row.faturaNo).trim().toUpperCase()) : null);
```

Sonra bağlanıyor (6247-6255: `documentId`, `isTransferred: true`) ve mevcut belge **üzerine yazılıyor** — 13663-13673:

```ts
tx.invoiceAccountingDocument.update({
  where: { id: existing.id },
  data: { source, sourceRefId,
    invoiceKind: direction,        // ← YÖN DEĞİŞİYOR
    originalName: stored.originalName,
    mimeType: stored.mimeType, sizeBytes: ..., s3Key: stored.s3Key,   // ← DOSYA DEĞİŞİYOR
```

Bu alanlar `shouldRewriteAccounting` şartının dışında, yani her zaman yazılıyor. Üstelik 13709-13711 eski dosyayı siliyor:

```ts
if (existing.s3Key && existing.s3Key !== stored.s3Key && ...) this.storage.deleteObject(existing.s3Key)
```

**Etki.** FEDAT AYDOĞDU'nun `GIB2026000000083` alış faturası belge olarak duruyorsa, EFE NAKLİYAT'ın aynı numaralı faturası aktarılınca yeni belge açılmaz; FEDAT'ın belgesi EFE'nin görseli/XML'iyle ezilir, FEDAT'ın dosyası depodan silinir, gelen kutusu satırı "aktarıldı" işaretlenir. Bir fatura kayıp, bir belge yanlış içerikli. `invoiceKind` de o anki yöne çekilir — satış belgesi alışa dönebilir.

**Gerçekleşme olasılığı: yüksek.** GİB e-Arşiv numaraları satıcı başına sayaçtır; `GIB2026000000xxx` biçimi bütün küçük satıcılarda aynı. Aynı çakışma bu ofiste `EarsivFatura` tablosunda 5 kez yaşandı.

**Doğrusu aynı dosyada zaten yazılı.** `findDuplicate` (13734-13742) `belgeNo, sellerVkn, buyerVkn, totalAmount, faturaTarihi, invoiceKind` birlikte kullanıyor; `ettnIleMevcutBelge` (14223-14242) `tenantId + taxpayerId + invoiceKind + ettn` kullanıyor. Yalnız bu bağlama yolu dışarıda kalmış.

**Çözüm.**
1. 6137-6142 sorgusuna `sellerVkn` ve `invoiceKind` ekle; harita anahtarını `${invoiceKind}::${sellerVkn}::${belgeNo}` yap.
2. Satıcı VKN'si boş olan satırda belge-no eşleşmesini hiç kullanma (ETTN'e düş).
3. Mevcut çiftler temizlendikten sonra şemaya `@@unique([tenantId, taxpayerId, invoiceKind, belgeNo, sellerVkn])` ekle.
4. 13665-13673'teki `s3Key`/`invoiceKind` üzerine yazmayı ETTN teyidine bağla; teyit yoksa yazma.

---

## Bulgu 5 — İki mükellefin aynı ETTN'li belgesi karışıyor → KISMEN DOĞRU

**Yanlış olan kısım.** "Ofis geneli" değil; sorgu mükellef listesiyle sınırlı — `apps/api/src/efatura-adapters/efatura-sync.service.ts`, `listInbox` (175), satır 299-310:

```ts
where: {
  tenantId,
  ...(tpIdler.length ? { taxpayerId: { in: tpIdler } } : {}),   // ← mükellef süzgeci VAR
  OR: [ { sourceRefId: { in: cesitler } },
        ...cesitler.map(v => ({ ocrData: { path: ['ettn'], equals: v } })) ],
}
```

**Doğru olan kısım (iddianın özü).** Eşleştirme haritası yalnız ETTN ile anahtarlanıyor — 292 ve 314:

```ts
const capraz = new Map<string, { documentId: string; kaynak: string }>();
for (const a of anahtarlar) if (!capraz.has(a)) capraz.set(a, { documentId: b.id, kaynak: b.source });
```

Haritada mükellef kimliği ve yön **yok**. Kullanım — 361: `const bulunan = capraz.get(ettnAl(row));`

Ve süzgeç `{ in: tpIdler }`, yani o listedeki bütün mükellefler. `listInbox`'ta `taxpayerId` zorunlu değil (179) ve denetleyici (`fatura-muhasebelestirme.controller.ts:685`) sorgu parametrelerini süzmeden geçiriyor. Mükellef verilmezse `where = { tenantId }` → satırlar bütün mükelleflerden gelir.

**Etki.** A mükellefinin alış satırı, B mükellefinin aynı ETTN'li satış belgesi varsa ekranda "Aktarıldı" görünür. Kullanıcı Aktar'a basmaz → fatura hiç aktarılmaz. Ayrıca satıra başka mükellefin `documentId`'si yazılıyor; tıklanınca o mükellefin belgesi açılır (gizlilik sızıntısı).

**Bulgu 4'ten farkı.** Bu yol yalnız okuma/gösterim; veritabanına yanlış bağlama yazmıyor. Zarar "ekran yanlış + fatura atlanır", "belge ezilir" değil.

**Gerçekleşme olasılığı: bugün uyuyor, yarın tuzak.** Uygulamanın kendi içindeki iki çağıranın ikisi de mükellefi zorunlu kılıyor: ekran (`page.tsx:2736`) ve yapay zeka aracı (`tool-executor.service.ts:5371-5373` → mükellef boşsa iş başlamıyor; 5375-5381 mükellefin o ofise ait olduğunu ayrıca doğruluyor). Yani portal normal kullanılırken karışma tetiklenmiyor.

Açık tek kapı denetleyicinin kendisi: `fatura-muhasebelestirme.controller.ts:683-687` sorgu parametrelerini süzmeden geçiriyor ve `listInbox` (179) mükellefi isteğe bağlı sayıyor. Mükellef vermeden yapılan `GET /fatura-muhasebelestirme/efatura-inbox?period=2026-08` karışmayı doğrudan üretir. Üçüncü bir çağıran eklendiğinde (toplu ekran, rapor, mobil uç, yeni bir araç) sessizce uyanır — belirtisi "hata" değil "fatura eksik" olur, fark edilmesi en zor tür. Ayrıca yön hiç karşılaştırılmadığı için **tek mükellefte bile** alış satırı satış belgesine bağlanabilir. Düzeltme iki satır olduğu için ertelemeye değmez.

**Çözüm.** Harita anahtarını `${taxpayerId}::${yon}::${ettn}` yap; belge sorgusuna `invoiceKind` süzgeci ekle, `select`'e `taxpayerId` ve `invoiceKind` al. `taxpayerId` yoksa çapraz eşleştirmeyi hiç çalıştırma. Denetleyicide `taxpayerId`'yi zorunlu kıl. `@@index([tenantId, taxpayerId, invoiceKind, sourceRefId])` ekle.

---

## Bulgu 15 — Dönem kuralı tutarsız → DOĞRULANDI (üç ayrı kural var)

**Kanıt.** Aynı dosyada, aynı fonksiyon içinde iki farklı kural.

Yardımcı işlev `rowInCurrentImportPeriod` — 6154-6168:

```ts
const rawPeriodMatches = String(raw.period || '') === opts.period
  || (!!raw.queryPeriodStart && !!raw.queryPeriodEnd
    && String(raw.queryPeriodStart) < endYmd && String(raw.queryPeriodEnd) >= startYmd);
```

Asıl döngü — 6228-6231:

```ts
const rawPeriodMatches = String(raw.period || '') === opts.period;   // ← kesişim yok
if (validRowDate ? !dateMatches : !rawPeriodMatches) continue;
```

**Fark gerçekten davranış değiştiriyor.** Serbest tarih aralığıyla sorgulanınca dönem etiketi `YYYY-AA-GG_YYYY-AA-GG` oluyor (5595-5596), bu etiket `raw.period`'a yazılıyor (5726, 5951), ama `monthRange` (9474) ve ekran hep `YYYY-AA` gönderiyor. Satırın tarihi de boş olabiliyor (5935).

Somut senaryo: 1-31 Ağustos serbest aralığıyla sorgulanan, tarihi okunamamış fatura. `raw.period = "2026-08-01_2026-08-31"`, ekran `opts.period = "2026-08"` gönderiyor.
- Yardımcı işlev: kesişim var → **satır bu döneme ait**.
- Asıl döngü: metin eşitliği yok → **satır atlanıyor**.

Sonuç: yardımcı işlev 6179'da toplu belge indirme hedefine bu satırı **koyuyor** (belge indiriliyor), asıl döngü aynı satırı **atlıyor**. Fatura hiç aktarılmıyor; sayaçta "atlandı" olarak bile görünmüyor (`processed++` bile çalışmıyor) — sessiz kayıp.

**Üçüncü kural.** `iptalSayac` (8557) bambaşka bir kural kullanıyor: `{ AND: [{ faturaDate: null }, { rawJson: { path: ['period'], equals: q.period } }] }`.

**Çözüm.** Tek kural, tek yer: 6228-6231 yerine `if (!rowInCurrentImportPeriod(row)) continue;`. `iptalSayac` de aynı yardımcıya çevrilsin. Ek koruma: `raw.period` hep `YYYY-AA` yazılsın, serbest aralık ayrı alanda (`periodLabel`) tutulsun.

---

## Bulgu 6 — Sınırdan sonra dönem süzmesi → DOĞRULANDI

**Kanıt A — liste.** `efatura-sync.service.ts`, `listInbox`:

```
197:  if (!opts.channel) where.faturaDate = { gte: start, lt: end };   ← kanal varsa SQL'e dönem GİRMİYOR
200:  const take = opts.channel ? Math.min(limit * 3, 5000) : limit;
203:  orderBy: { syncedAt: 'desc' },                                   ← fatura tarihi değil, çekim anı
333:  if (channel && String(raw?.channel || '').toUpperCase() !== channel) return false;   ← bellekte
337-341: dönem karşılaştırması da bellekte
343:  .slice(0, limit)
```

Arayüz **her zaman** kanal gönderiyor: `page.tsx:2551` (`useState('IN_EFATURA')`, hiç boş olmuyor), `:2736`. Yani `where.faturaDate` pratikte hiç kurulmuyor.

**Kanıt B — aktarım.** `fatura-muhasebelestirme.service.ts`:

```
6096:  if (!opts.channel) where.faturaDate = { gte: start, lt: end };
6101:  take: Math.min(Math.max(Number(opts.limit || 500), 1), 1000),   ← sert tavan 1000
6225:  if (String(raw.channel || '').toUpperCase() !== channel) continue;   ← bellekte
```

Arayüz `limit: 2000` gönderiyor (`page.tsx:2891`) ama sunucu 1000'e kırpıyor. `where` içinde `direction` var, `channel` yok.

**Etki.** Çok e-Arşiv kesen bir mükellefte "OUT" yönünde en yeni 1000 satır çoğunlukla e-Arşiv olur. Kullanıcı `OUT_EFATURA` seçip Temmuz'u aktarmak isterse dilim içinde e-Fatura kalmaz → **Temmuz e-Faturaları hiç aktarılmaz, hata da vermez**, sayaç "0 belge" der. Liste tarafında 5.000'den fazla satırı olan mükellefte (kodun kendi yorumu `controller.ts:708`'de "TURKCELL: 47k+ fatura" diyor) eski aylar hiç görünmez. `syncedAt` sıralaması ayrıca kararsız.

**Çözüm.** Dönem ve kanal süzmesini SQL'e taşı. `channel` `rawJson` içinde olduğu için ya `eFaturaInbox`'a kalıcı `channel` sütunu ekle (+ `[tenantId, taxpayerId, channel, faturaDate]` index) ya da JSON yolu üzerinden süz. `where.faturaDate` kanal olsa da her zaman kurulsun. `orderBy` `faturaDate` olsun; kırpma gerekiyorsa imleçli sayfalama kullan.

---

# BÖLÜM C — Görüntüleme isteğinin veri değiştirmesi

## Bulgu 11 — Liste açmak hesap kodlarını siliyor → DOĞRULANDI (iddiadan geniş)

**En yüksek aciliyet: her ekran açılışında çalışıyor ve hiç izi yok.**

**Kanıt.** `fatura-muhasebelestirme.service.ts:987-1015`:

```ts
987:  private async gateExistingDocsIfNoPlan(tenantId: string, taxpayerId?: string) {
988:    if (!taxpayerId) return;
990:    const docs = await this.prisma.invoiceAccountingDocument.findMany({
991:      where: { tenantId, taxpayerId, status: { not: 'APPROVED' } },
1000:    if (!planCodes) {
1001:      await this.prisma.invoiceAccountingLine.updateMany({
1002:        where: { documentId: { in: docIds }, NOT: { accountCode: null } },
1003:        data: { accountCode: null },
1004:      }).catch(() => {});
```

**Her liste açılışında çalışıyor.** `service.ts:1021` → `list()` işlevinin ilk satırı: `await this.gateExistingDocsIfNoPlan(tenantId, opts.taxpayerId);`. `controller.ts:86-94` → bu düz bir `@Get('documents')`. `providers.tsx:10` → `staleTime: 60s`, `refetchOnWindowFocus` kapatılmamış → pencereye her dönüşte tazelenir, yazma tekrar tetiklenir. Bu uca giden ekranlar: `page.tsx:1374` (Gelen Faturalar), `:3971`, `:4334` (Muhasebeleştir), `:5272` (Aktarım/Arşivim).

**WHERE'de eksik olanlar (bulguyu iddiadan geniş yapan kısım):**

| Koşul | Var mı |
|---|---|
| `tenantId`, `taxpayerId`, `status != 'APPROVED'` | var |
| Dönem sınırı | **yok** — mükellefin tüm yıllarındaki belgeleri |
| `lucaStatus` koruması | **yok** (başka yerlerde var: 8140, 8581) |
| `kaynak` koruması | **yok** → elle girilmiş kod (`kaynak='KULLANICI'`) da siliniyor |

Tek gerçek fren: 988 `if (!taxpayerId) return;` — "Tüm mükellefler" görünümü tetiklemiyor.

Onaylı/aktarılmış belgeler güvende (onay yolları `status:'APPROVED'` yazıyor), yani iddianın sınırı doğru.

"Plan var" dalı da zararsız değil: `PLACEHOLDER_CODES` (980-986) içinde `320.01.001`, `120.01.001`, `360.01.001` gibi elle girilmesi çok olağan kodlar var. Müşavir bu kodu elle yazdıysa ve Luca planında yoksa bir sonraki liste açılışında sessizce silinir.

**Etki.** Planı henüz çekilmemiş bir mükellefte müşavir 40 belgenin hesap kodlarını elle girip onaylamadan bıraktı. Ertesi gün Fatura Merkezi'ni açtı → 40 belgenin tüm hesap kodları boş. Yapılan iş kayıp. Ek risk: `planSumQ` (`page.tsx:1697-1704`) hata yutuyor → hata anında `planMissing=false` olur, yani **açıklayıcı uyarı bandı gizlenirken silme yine çalışır.**

**Geçmişte olmuş olabilir mi? İzi var mı?** Olmuş olması muhtemel, ama **iz yok**: işlevin içinde tek `logger` satırı yok, `logAudit` hiç çağrılmıyor (oysa 7995, 8063, 8367'de kullanılıyor), her iki `updateMany` da `.catch(() => {})` ile sessiz. Kısmi parmak izi: `accountCode IS NULL` ve `kaynak IS NOT NULL` olan satırlar — ama `gateCodesByPlan` (14393) yazma anında aynı deseni ürettiği için iki sebep ayırt edilemez. **Geriye dönük kesin sayı çıkarılamaz.**

**Çözüm.**
1. `list()` içindeki 1021 çağrısını **kaldır**. Okuma isteği yazmamalı.
2. Aynı sonucu sunum katmanında üret: `list()`/`get()` dönerken `gateCodesByPlan` (14376) mantığını satırlara **bellekte** uygula. Kullanıcı "eksik kod" görür, veri bozulmaz.
3. Kalıcı temizlik yalnız açık yazma yollarında kalsın: `reapply-codes` (POST), hesap planı çekimi sonrası, ya da tek seferlik taşıma.
4. Kalıcı silme kalacaksa en az üç koruma: `kaynak: { not: 'KULLANICI' }`, `lucaStatus: { notIn: ['POSTED','POSTING','MANUAL_DONE','QUEUED'] }`, dönem sınırı.
5. `catch(() => {})` yerine `logger.warn` + `logAudit`.

---

# BÖLÜM D — Yetki

## Bulgu 3 — Rol ve mükellef sınırı eksik → KISMEN DOĞRU

### Doğrulanan kısım: rol kontrolü yok

`fatura-muhasebelestirme.controller.ts:40-42`:

```ts
@Controller('fatura-muhasebelestirme')
@UseGuards(AuthGuard('jwt'))
export class FaturaMuhasebelestirmeController {
```

Sınıf seviyesinde yalnız giriş kontrolü. Dosyada `RolesGuard` 0 kez, `@Roles(` 0 kez geçiyor.

69 uç var; 7'sinde ek olarak `@UseGuards(OwnerOnlyGuard)` var (81, 419, 518, 531, 605, 774, 780 — hepsi bakım uçları). **Kalan 62 uç yalnız "giriş yapmış olmak" ile açık.** Aralarında:

| Satır | Uç | Ne yapar |
|---|---|---|
| 550 | `POST documents/:id/approve` | Belgeyi onaylar |
| 559 | `POST documents/approve-batch` | 200 belgeyi toplu onaylar |
| 633 | `POST batch-post-to-luca` | Luca'ya fiş aktarır |
| 665 | `DELETE documents/:id` | Belgeyi siler |
| 545 | `PATCH documents/:id` | Belge alanlarını değiştirir |
| 118 / 148 | `POST` / `DELETE integrations` | Entegratör kimlik bilgisi yazar/siler |
| 212 | `POST kdv-raporu/whatsapp` | Mükellefe WhatsApp mesajı gönderir |

Rol modeli mevcut — `schema.prisma:97-107`: `ADMIN`, `STAFF`, `READONLY` ("Salt okunur erişim"), üçü de kayıtta oluşturuluyor (`auth.service.ts:210-226`).

Global rol guard'ı yok — `app.module.ts:126` tek global guard olarak `ThrottlerGuard` veriyor.

**Doğru kalıp projede zaten var** ve 25'ten fazla controller kullanıyor. Örnek `documents.controller.ts`:

```ts
46: @UseGuards(AuthGuard('jwt'), RolesGuard)
51:   @Get()                        // okuma → rol şartı yok (READONLY görebilir)
131:  @Roles('ADMIN', 'STAFF')      // yazma → READONLY giremez
217:  @Roles('ADMIN')               // silme → yalnız ADMIN
```

Aynısı `taxpayers`, `kdv-control`, `luca`, `edefter-control`, `mizan`, `banka-takip`, `earsiv` controller'larında var. Fatura Merkezi bu kalıbın dışında kalmış.

**Somut etki:** Kullanıcı ekleme ekranı (`apps/web/src/app/(panel)/panel/ayarlar/kullanicilar/page.tsx:385`) açıkça *"Sadece görüntüleme: verileri görür, değişiklik yapamaz"* diyor. Bu vaat Fatura Merkezi'nde tutulmuyor: READONLY biri belge onaylayabilir, silebilir, Luca'ya fiş aktarabilir, entegratör kaydını silebilir, mükellefe WhatsApp gönderebilir. STAFF ile ADMIN arasında da hiçbir fark yok.

### Yanlış olan kısım: mükellef hesabı erişimi

Mükellef kimliği ayrı ve bu uçlara **erişemiyor**:

- `taxpayer-portal/strategies/taxpayer-jwt.strategy.ts:30-41` → `payload.type !== 'taxpayer'` reddediyor, `taxpayers` tablosuna bakıyor.
- `auth/strategies/jwt.strategy.ts:21-26` → `users` tablosuna bakıyor.

İki strateji aynı gizli anahtarı kullanıyor ama farklı tabloya bakıyor: mükellef token'ının `sub`'ı `users`'ta bulunmaz → `jwt` stratejisi 401 verir. Mükellef kendi uçlarını `AuthGuard('taxpayer-jwt')` ile kullanıyor, hepsi salt okuma ve kendi kimliğine kilitli. **Denetçinin "aynı ofise bağlı müşteri hesabı başka mükelleflerin belgelerine erişir" senaryosu gerçekleşemez.**

Ofis izolasyonu da sağlam: controller'da `tenantId` geçen her yer `req.user.tenantId`; gövdeden/sorgudan tenant alan tek satır yok. Servis de hep tenant'a süzüyor (1017, 3418, 8901).

### Ayrıca: kullanıcı-mükellef eşleme modeli projede hiç yok

Şemada `UserTaxpayer` / `assignedTaxpayers` / `taxpayerAccess` diye bir model yok; tek benzer alan `TaxDeclaration.assignedUserId` (614) ki o görev ataması. Yani "kullanıcının erişebileceği mükellef listesi" kavramı sistemde tanımlı değil — bu Fatura Merkezi'ne özgü bir eksik değil, projenin genel tasarımı. Denetçinin bunu bu modüle özel bir açık gibi yazması yanıltıcı.

### Riskin dürüst boyutu

Dışarıdan sömürülebilir bir açık **değil**; içeriden yetki aşımı açığı. Gerekenler: ofiste yönetici dışında bir hesap ve o hesabın şifresi. Bugün tek yönetici hesabı varsa pratik risk **şu an sıfır**. Ama:
- Kullanıcı ekleme ekranı READONLY'yi sunuyor ve yanlış vaat veriyor → **ilk personel eklendiği gün açık gerçek olur.**
- Portalı abonelikle satma planında çok kullanıcılı kullanım hedefleniyor → o senaryoda engelleyici seviyede.

**Çözüm.** Yeni altyapı gerekmiyor:
1. `controller.ts:41` → `@UseGuards(AuthGuard('jwt'), RolesGuard)`.
2. Okuma uçları (`@Get`) dekoratörsüz kalsın → READONLY görmeye devam eder.
3. Değiştiren/gönderen uçlara `@Roles('ADMIN','STAFF')`.
4. `DELETE documents/:id` ve `POST`/`DELETE integrations` → `@Roles('ADMIN')` (diğer modüllerde silme zaten ADMIN).

**Uygulama tuzağı:** `RolesGuard` (`roles.guard.ts:14`) `if (!requiredRoles) return true;` diyor — guard'ı eklemek tek başına hiçbir şeyi kırmaz, kademeli eklenebilir. Ama `users.service.ts:57-74` `roleName`'i serbest metin olarak yazıyor; yazım hatasıyla oluşmuş rol varsa ("staff", "Staff") guard o kullanıcıyı dışarıda bırakır ve personel kilitlenir. **Uygulamadan önce veritabanındaki rol adları teyit edilmeli.**

Not: `GET integrations` gizli bilgi sızdırmıyor — `service.ts:1231` yalnız `hasApiKey`/`hasPassword` gibi doğru-yanlış döndürüyor.

---

# BÖLÜM E — Ekran doğruluğu ve güven

## Bulgu 7 — Genel Bakış toplamı → DOĞRULANDI + ek bulgu

**Kanıt — ön yüz.** `page.tsx:7700-7713`:

```ts
const donutTotal = tot.pending + tot.posted + tot.issue;           // "Toplam Belge" kutusu
const completionPct = donutTotal > 0 ? Math.round((tot.posted/donutTotal)*100) : 0;
```

**Kanıt — API.** `service.ts:2611-2626`:

```ts
const pending  = status==='READY'||status==='NEEDS_REVIEW'||status==='PENDING'||status==='PROCESSING';
const approved = status==='APPROVED';
if (pending) { ... } else if (approved) { ... }
if (d.lucaStatus === 'POSTED') entry.postedToLuca++;                 // ← AYRI if, durumdan bağımsız
if (vStatus==='INVALID'||vStatus==='INCOMPLETE') entry.hasIssue++;   // ← AYRI if, durumdan bağımsız
```

`pending`/`approved` birbirini dışlıyor, ama `postedToLuca` ve `hasIssue` ikisinden de bağımsız sayılıyor.

**Sonuçlar:**
1. **Çift sayma:** onay bekleyen + doğrulaması bozuk belge hem `pending` hem `issue`'da; aktarılmış + bozuk belge hem `posted` hem `issue`'da.
2. **Hiç sayılmayanlar:** onaylı ama aktarılmamış belgeler `donutTotal`'e girmiyor (oysa sol menüde `page.tsx:1216` "Aktarım" rozeti tam onları gösteriyor); `pendingBanka` toplama girmiyor; `lucaStatus === 'MANUAL_DONE'` (elle işlendi) hiçbir sayaçta yok.
3. **Ek bulgu — "sorunlu" sayacı büyük ölçüde ölü.** `perTaxpayerSummary` doğrulama durumunu yalnız `ocrData.validationStatus`'tan okuyor (2625), oysa gerçek kaynak veritabanı sütunu (`schema.prisma:2606`) ve yeniden doğrulama sadece sütunu yazıyor (7505-7513). Kodun kendi yorumu bunu söylüyor — `service.ts:8948`: *"validationStatus DB KOLONUNDAN oku (ocrData'da değil… eski filtre ölüydü)"*. 1.181 belgede yalnız 2 "sorunlu" çıkmasının sebebi bu. Seçimde `validationStatus` alanı hiç istenmiyor (2578-2586).

**Etki.** "Toplam Belge 1.181" tekil belge sayısı değil. Yüzde halkası da bozuk paydadan geliyor: aktarım kuyruğundaki onaylı belgeler paydada olmadığı için oran **olduğundan yüksek** çıkıyor — "işim bitmiş" görünürken aktarım bekleyen yığın tabloda görünmüyor.

**Çözüm.** Toplam tek `count` sorgusuyla ya da ayrık kümelerden (`bekleyen + onaylı-aktarılmamış + aktarılmış`) gelsin; `issue` toplama katılmasın, üstüne binen bir etiket olsun. `pendingOf`'a `pendingBanka`, `postedToLuca`'ya `MANUAL_DONE` eklensin. `perTaxpayerSummary` seçimine `validationStatus: true` eklenip okuma `d.validationStatus || d.ocrData?.validationStatus` olsun (kodun diğer 5 yerinde zaten böyle: 1071, 1892, 8816, 8958); aynısı `summary` (1505) için de. Doğru sunum örneği aynı dosyada var: Mükellefler ekranı bu dördünü ayrı sütun gösteriyor, toplamıyor (`page.tsx:3848-3851`).

---

## Bulgu 8 — Üst seçim uygulanmıyor → DOĞRULANDI

Üst şeritteki mükellef seçicisi koşulsuz çiziliyor (`page.tsx:1256-1268`); dönem seçicisi yalnız Gelen Faturalar'da gizleniyor.

Genel Bakış'a mükellef hiç verilmiyor — 1300: `<ScreenGenel taxpayers={} period={} onOpen={} />`; sorgu yalnız `period` gönderiyor (7692-7696).

Belge Akışı'nda prop **veriliyor ama alınmıyor** — 1301 `<ScreenAkis taxpayerId={taxpayerId} ... />`, ama imza 7386:

```ts
function ScreenAkis({ taxpayers, onOpenMuhasebe }: { taxpayerId: string; taxpayers: any[]; ... })
```

`taxpayerId` tipte var, destructure edilmiyor → gövdede erişilemiyor. Yerine yerel `useState('')` (7390) kullanılıyor. `period` ise hiç geçmiyor; ekran kendi süzgecini kullanıyor (varsayılan son 30 gün, 7393).

**Etki.** Zeki Özkaynak / Ağustos 2026 seçiliyken Genel Bakış'ta görünen 1.181 / 542 / 637 / 2 **14 mükellefin toplamı**. Belge Akışı'nda üst seçicilerin ikisi de tamamen ölü.

**Çözüm.** Genel Bakış'a `taxpayerId` geçilsin ve doluysa satırlar süzülsün (satır zaten `taxpayerId` taşıyor); süzülmeyecekse üst şerit o ekranda "Tüm mükellefler"e sabitlensin. Belge Akışı'nda ya prop'lar gerçekten kullanılsın ya tipten kaldırılıp seçici gizlensin. Kural: seçicinin görünür olduğu her ekran onu uygulamalı.

---

## Bulgu 9 — KDV karar kartı → DOĞRULANDI

**Kanıt.** `page.tsx:6562-6566`:

```tsx
{rep?.devreden && Number(t.payableVat) > 0 ? (
  <div className="kdvst kdvst-ode">…Ödenecek KDV (tahmini)…</div>
) : (
  <div className="kdvst kdvst-son">…Sonraki Döneme Devreden (tahmini)…
    <div className="ka">{rep?.devreden ? 'ödeme çıkmıyor' : 'devreden bilinmeden hesaplanamaz'}</div>
```

Tek koşul: önceki dönem devredeni var mı + ödenecek > 0 mı. **Kaynak uyuşmazlığı (`teyit.uyariSayisi`), onaysız belge sayısı (`rep.kaynak.onaysiz`), hesap atanmamış belge sayısı karara hiç girmiyor** — her ikisi de aynı bileşenin kapsamında duruyor, yani teknik engel yok.

Tutarın çıkışı — `service.ts:1939-1940`: `payableVat = max(0, salesVat - tevkifat - purchaseVat - devreden)`. Satış 0 → fark negatif → ödenecek 0 → "ödeme çıkmıyor". Canlı gözlemle birebir uyuşuyor.

Onaysız belgeler toplama dahil (`service.ts:1662-1664` yorumu) ve uyarı kartların **altında** duruyor (6219, 6326-6333). API'nin ürettiği "N onaysız belge toplamlara dahil" notu (`service.ts:1870-1872` → `report.notlar`) **ekranda hiç çizilmiyor** — `page.tsx`'te `rep.notlar` kullanan yer yok. Kartın rengi yeşil (9052), yani ekran görsel olarak "sorun yok" diyor.

**Etki.** Ekran 6 fark ve 8 onaysız belge bildirirken en üstte yeşil kutu "ödeme çıkmıyor" diyor. FM 0,00 derken KDV Kontrol 33.340, Luca mizanı 58.340 gösteriyor — satış KDV'si FM'ye girmemiş görünüyor. Bu tabloda "ödeme çıkmıyor" ifadesi yanlış; eksik beyana ve cezaya yol açabilir. Aynı cümle mükellefe giden çıktıya da düşüyor (6477-6481).

**Çözüm.** Karara kapı: `teyit?.uyariSayisi > 0 || rep?.kaynak?.onaysiz > 0 || rep?.hesapAtanmamis?.count > 0` ise kart nötr/amber olsun, metin "sonuç henüz kesinleşmedi — N fark, M onaysız belge" olsun, teyit paneline bağlantı taşısın. Daha sert bir durum: `calculatedVat === 0` iken diğer kaynaklardan biri sıfırdan farklıysa sonuç hiç gösterilmesin, "satış belgeleri eksik görünüyor" densin. `report.notlar` ekranda çizilsin. Aynı kapı PDF çıktısına da uygulanmalı.

---

## Bulgu 10 — Liste kayıt sınırı → DOĞRULANDI

```
page.tsx:1010   params: { ..., limit: tum ? 2000 : 300 }     ← sayfalama yok
service.ts:1041 take: Math.min(Math.max(opts.limit || 100, 1), 2000)
service.ts:1039 orderBy: { createdAt: 'desc' }               ← fatura tarihi değil, kayıt anı
controller.ts:86-94  @Get('documents') — sayfalama parametresi yok
```

| Ekran | Gelen | Sonra ne oluyor |
|---|---|---|
| Gelen Faturalar (1374) | 2.000 | — |
| Muhasebeleştir (4334) | **300** | ekranda süzülüyor |
| Aktarım / Arşivim (5272) | **300**, durum süzgeci yok | 5275 `all.filter(...)` — **eksik küme üzerinde** |
| KDV ayrıntısı (6411) | **500** | id→belge haritası |

**Etki.** Temmuz'da 500 belge girilmiş mükellefte sunucu en yeni 300'ü verir; Arşivim bunların içinden aktarılmışları süzer → **ilk girilen 200 belge Arşivim'de hiç görünmez**, uyarı da çıkmaz.

Tek istisna: KDV ayrıntısı bunu açıkça söylüyor — `page.tsx:6285`: *"Belge listede bulunamadı (500 belge sınırı ya da silinmiş)"*.

**Çözüm.** Kısa vadeli ve daha doğru çözüm: **süzgeci sunucuya taşı** — Arşivim `lucaStatus=POSTED`, Aktarım `lucaStatus in (QUEUED,POSTING,FAILED) or status=APPROVED` parametresiyle çağırsın; o zaman 300'lük dilim doğru kümeden gelir. Kalıcı çözüm: `@Get('documents')`'a `skip`/`cursor` + `total` ekle, `useDocuments`'ı sonsuz sorguya çevir. `orderBy` ekrana uygun alan olsun. Sınır aşıldığında "liste kırpıldı" bandı göster (KDV ekranındaki kalıp gibi).

---

## Bulgu 12 — Hata boş sonuç gibi görünüyor → KISMEN DOĞRU

**Yanlış olan kısım: ana belge listesi zaten düzeltilmiş.**

```
page.tsx:1006  // Hatayı YUTMA — react-query isError versin ki "Yüklenemedi, tekrar dene" gösterelim
page.tsx:2014  {docsQ.isError && ( ... "Belgeler yüklenemedi (bağlantı/sunucu hatası) — 'veri yok' değil." )}
```

Aynı kalıp 3354, 3503, 6571, 7041, 7608, 6587'de de var. Ayrıca **"Bekleyen belge yok — her şey güncel" diye bir metin kodda yok**; en yakınları boş liste durumunda çıkan "Aktarıma hazır belge yok" (5842-5845) gibi metinler.

**Doğru olan kısım: yan sorgular hata yutuyor.**

| Satır | Sorgu | Hata anında görünen |
|---|---|---|
| 1149 | `/taxpayers` → `[]` | Mükellef listesi boş |
| 1167, 1177 | `/summary` → `{}` | **Menü rozetleri sessizce kaybolur** → "bekleyen iş yok" izlenimi |
| 3961, 4541, 7191 | `/account-plan` → `[]` | Hesap planı boş görünür |
| 6393 | `/kdv-client-report` → **`null`** | **KDV ana raporu boş** — iddia burada tam doğru |
| 7697 | `/per-taxpayer-summary` → `[]` | Genel ekran tüm sayıları 0 gösterir |

**Etki.** En somut zarar 1167/1177 ve 7697: API bir an cevap vermediğinde sol menü rozetleri ve Genel ekran **sıfır** gösterir; "bugün bekleyen iş yok" sanılabilir. 6393'te KDV ana raporu boş çıkarken yanındaki teyit kutusu hata veriyor — çelişkili ekran.

**Çözüm.** 1167, 1177, 6393, 7697'de `.catch(...)` kaldırılıp mevcut kalıp (1006/2014) uygulanmalı. Rozetler için hata durumunda sayı yerine "—" gösterilsin, 0 gösterilmesin. `/account-plan` hatasında kod seçici "plan getirilemedi" ile kilitlenmeli — aksi hâlde boş plan, Bulgu 11'deki silme mantığıyla birleşip yanıltıcı olur.

---

# Doğrulama güvencesi hakkında

Denetim raporunun "122 sınama geçti ama bazıları metin arıyor" uyarısı **doğru**:

- `scripts/fatura-accounting-guards-regression.cjs:44` → `service.includes('isletmeDocumentReady(doc)')` — kaynakta yazı arıyor.
- `scripts/luca-upload-contract-regression.cjs:26` → `requireText` tüm kaynağı birleştirip içinde metin arıyor.
- `scripts/fatura-kes-tutar-birim-regression.cjs:31` → betiğin kendi `sayi()` kopyasını test ediyor, uygulamanın işlevini değil.
- `scripts/gib-earsiv-payload-regression.cjs:48` → kendi `gibTutar()` kopyası + regex ile kaynakta arama.

Yani mevcut sınamaların geçmesi çift kayıt, yetki ve eşzamanlılık için güvence değil. Bu dört betik davranış sınamasına çevrilmeli.

Denetçinin bir başka iddiası **doğrulanmadı**: doğrulama sırasında "YORGUN NAKLİYAT'ta 501 belge kaybı yaşandı" biçiminde bir olay öne sürüldü; proje kayıtlarında böyle bir olay yok. Gerçek ve kayıtlı olay `schema.prisma:2990`'da yazılı: 2026-08-20, YORGUN NAKLİYAT Temmuz, Luca'da 30 portalda 25 fatura, 5 çift = 5 kayıp fatura.

---

# Kapsam dışı ek bulgu

Denetçinin listesinde yok, doğrulama sırasında çıktı: `update()` (`service.ts:7096`) `POSTED` belgeyi engellemiyor ve gövdeden gelen `status` alanını doğrudan yazıyor — Luca'ya gitmiş belgenin tutar/hesap satırları değiştirilebilir. Bulgu 1 ile aynı bölgede duran ayrı bir açık; aynı kapı oraya da konmalı.

---

# Önerilen düzeltme sırası

**Faz 0 — Sessiz veri kaybını durdur (en acil)**
1. Bulgu 11: `list()` içindeki silme çağrısı kaldırılsın, kural sunum katmanına alınsın.
2. Bulgu 14(a): araç başarı doğrulamadan "tamam" demesin; `markJobDone` beklenen/gelen sayıyı karşılaştırsın; fiş numarası kaydedilsin.

**Faz 1 — Çift kayıt kapıları**
3. Bulgu 1 + kapsam dışı ek bulgu: `approve()`, `retryLucaPost()`, `update()` için `POSTED/POSTING` kapısı; koşullu `updateMany`.
4. Bulgu 13: süren işe tek belge yeniden denemesi verilmesin; `markJobDone` ölü işi diriltmesin.
5. Bulgu 2: kapma içerikten önce yapılsın, içerik yalnız kapılan belgelerden üretilsin.

**Faz 2 — Belge kimliği ve kapsam**
6. Bulgu 4: belge-no eşleşmesine satıcı VKN + yön; dosya üzerine yazma ETTN teyidine bağlı; ardından bileşik tekillik kısıtı.
7. Bulgu 5: harita anahtarı mükellef + yön + ETTN; mükellef parametresi zorunlu.
8. Bulgu 15: tek dönem kuralı (üç yer birleştirilsin).
9. Bulgu 6 + 10: dönem/kanal süzgeci ve aşama süzgeci sunucuya; sayfalama.

**Faz 3 — Yetki**
10. Bulgu 3: `RolesGuard` + `@Roles` (önce veritabanındaki rol adları teyit edilerek).

**Faz 4 — Ekran doğruluğu**
11. Bulgu 7 (+ ölü "sorunlu" sayacı), 8, 9, 12.

**Faz 5 — Güvence**
12. Dört metin-arayan sınama davranış sınamasına çevrilsin; her düzeltme için kabul sınaması yazılsın: aynı belgeyi iki kez gönderme, kısmen örtüşen iki eşzamanlı iş, aynı numaralı iki satıcı, aynı ETTN'li iki mükellef, sınırdan fazla eski dönem belgesi, yetkisiz kullanıcı, bağlantı hatası, tek sorunlu belgenin toplamda bir sayılması, kısmi aktarımda başarı verilmemesi.

Canlıya alma ayrı onay gerektirir.

---

# UYGULAMA DURUMU (25 Eylül 2026, aynı gün tamamlandı)

Beş faz canlıya alındı: `aeb14fb` → `6a12720`. Her fazın sonunda ayrı onay alındı.

| # | Bulgu | Durum | Commit |
|---|---|---|---|
| 11 | Liste açmak kod siliyor | ✅ Çözüldü | aeb14fb |
| 14(a) | Aktarım sessizce "başarılı" | ✅ Çözüldü | aeb14fb |
| 1 | Aktarılmış belge yeniden kuyruğa | ✅ Çözüldü | 28d4ba1 |
| 13 | Tek belge denemesi ortak işi bozuyor | ✅ Çözüldü | 28d4ba1 |
| 2 | Kısmi kapmada bayat içerik | ✅ Çözüldü | 28d4ba1 |
| — | `update()` açığı (listede yoktu) | ✅ Çözüldü | 28d4ba1 |
| 4 | Aynı numaralı faturalar karışması | ✅ Çözüldü | 3bdf1ed |
| 5 | ETTN/yön karışması | ✅ Çözüldü | 3bdf1ed |
| 15 | Dönem kuralı tutarsızlığı | ✅ Çözüldü | 3bdf1ed |
| 6 | Sınırdan sonra dönem süzmesi | ✅ Çözüldü | 3bdf1ed |
| 10 | Liste kayıt sınırı | ✅ Çözüldü | 3bdf1ed |
| — | Mihsap'ta mükerrer kontrolü yok (listede yoktu) | ✅ Çözüldü | b37160f |
| 3 | Rol/yetki | ✅ Çözüldü | 0316d5e |
| 7 | Sayaç çift sayma + ölü sayaç | ✅ Çözüldü | d510714 |
| 8 | Ölü üst seçiciler | ✅ Çözüldü | d510714 |
| 9 | KDV "ödeme çıkmıyor" | ✅ Çözüldü | d510714 |
| 12 | Hata boş sonuç gibi | ✅ Çözüldü | d510714 |
| 14(b) | Hesap açma işine bağlı değil | ⏳ Yapılmadı | — |

## Canlı teşhis sonuçları (salt okuma, sahip onayıyla)

2.578 belge üzerinde ölçüldü:

- **Bulgu 4 gerçek:** aynı mükellefte aynı belge numarası 3–5 ayrı satıcıda var ("202" beş satıcıda).
- **Bulgu 5 uyuyordu:** aynı ETTN birden çok mükellefte **0 kayıt**. Kusur duruyordu, zarar oluşmamıştı.
- **Bulgu 11'in en kötü senaryosu gerçekleşmemiş:** `kaynak='KULLANICI'` olup kodu silinmiş satır **0**.
- **Mükerrer işareti sistemde 0** — tespit pratikte hiç iz bırakmamış; kökü Mihsap yolunda kontrolün
  hiç çağrılmaması olarak bulundu ve kapatıldı.
- **Sorunlu belge sayısı:** gerçek **77**, ekran **2** gösteriyordu (ölü sayaç).
- **Tekillik kısıtı EKLENMEDİ.** 47 çakışan grubun **46'sı meşru** (ÖKC fiş numarası satıcı bazlı
  tekrar ediyor; tarih ve tutar farklı). Kısıt bu kayıtları reddederdi. Sahip kararı: veritabanı kısıtı
  yerine mükerrer işaretini güçlendirmek — kısıt P2002 ile belgeyi hiç kaydetmeyip yeni bir sessiz
  kayıp yolu açabilirdi.

## Test güvencesi

Denetim raporunun "122 sınama geçti, güvence sayma" uyarısı **haklıydı ve tahmin edilenden kötüydü**:
dört betik metin arıyordu **ve zincirde üç test kırık duruyordu** (kimse fark etmiyordu, çünkü
`test:regression` commit'te koşmuyor).

- 4 metin-arayan betik davranış sınamasına çevrildi; **13 mutasyon deneyi, 13'ü kırmızı döndü.**
- Bu oturumda 8 yeni davranış sınaması yazıldı ve zincire alındı (34 → 42 betik).
- 4 bayat test düzeltildi (üçü önceden kırıktı, biri Faz 0 maskesinden kırılmıştı — gerçek kullanıcı
  etkisi yok, gerekçesi commit'te).
- **`pnpm test:regression` 42 betik, EXIT=0** — bu oturumda ilk kez tam yeşil.

## Kalan açık işler

1. **Bulgu 14(b):** hesap planı gönderimi başarısız olsa bile fatura işi kuruluyor; `ACCOUNT_PLAN_PUSH`
   önceliği fiş işinden düşük (ajan tarafı sıralaması çoğu zaman kurtarıyor).
2. Şema hız indeksi: `(tenantId, taxpayerId, invoiceKind, sellerVkn, belgeNo)` — doğruluk etkilenmiyor.
3. `shouldRewriteAccounting` bloğu kimlik kapısına alınmadı (düzeltilebilir veri; geri alınamaz zarar kapalı).
4. Sonsuz sayfalama (`useInfiniteQuery`) yapılmadı — süzgeç sunucuya taşındığı ve kırpılma bildirildiği için acil değil.
5. Arayüzdeki tutar çözümleyici (`mNum`) paylaşılan dosyaya taşınmalı; test şu an onu kaynaktan çıkarıp derliyor (kırılgan).
6. Kilitli modül baseline'ı bayat (5 dosya) — sahip "şimdilik dokunma" dedi.
7. `EY42026000192714` mükerrer çifti canlıda duruyor (ikisi de onaysız, Luca'ya gitmemiş).
