# Sayfalama / İletim Sözleşmesi — Beyanname İndirme · e-Tebligat · SGK (2026-09-14)

API ve web tarafı bu sözleşmeye göre AYNI ANDA yazılıyor. Alan adları birebir uyulacak. Eski uçlar (`GET /portal-automation/documents`,
`GET /beyan-kayitlari` sayfasız) mobil/masaüstü kullandığı için AYNEN kalır.

## 1. `GET /portal-automation/documents/sayfa`
Sorgu parametreleri:
- `belgeTuru` (zorunlu; virgülle çoklu: `E_TEBLIGAT` | `SGK_TAHAKKUK,SGK_HIZMET_LISTESI`)
- `taxpayerId?`
- `search?` — mükellef adı/VKN, belge no (`referenceNo`), kurum (`raw.kurumAciklama`/`raw.altKurum`), SGK'da dönem/kanun no; büyük-küçük harf duyarsız
- `period?` — SGK dönem: `YYYY/MM` ya da `YYYY-MM` (her ikisi de `period` alanıyla eşleşir); tebligatta `YYYY-MM` (issuedAt ayı)
- `durum?` — tebligat: `teblig_yaklasan` (tebliğ tarihine ≤2 gün) | `teblig_edildi` (tebliğ tarihi geçti) | `goruntulenmemis` (viewedAt null) ; SGK: `tahakkuk` | `hizmet` (birleşik modda yalnız o belgesi olanlar)
- `birlesik?` — `1` ise SGK belgeleri mükellef + `referenceNo` (yoksa `period`) bazında TEK satırda birleşir
- `page` (1…), `pageSize` (25|50|100; başka değer → 50; dışa aktarım için en çok 1000)
- `sirala?` — `yeni` (varsayılan: tebligat `issuedAt desc`, SGK `period desc`), `eski`, `mukellef`

Yanıt:
```ts
{
  rows: BelgeSatiri[];
  total: number;      // süzgece uyan toplam satır (birleşik modda birleşik satır sayısı)
  page: number; pageSize: number;
}
type IletimBilgisi = { channel: 'WHATSAPP' | 'EMAIL'; status: 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED'; sentAt: string | null; error: string | null; testMode: boolean };
type BelgeSatiri = {
  id: string;                       // birleşikte tahakkuk id'si (yoksa hizmet id'si)
  taxpayerId: string | null;
  taxpayer: { id: string; companyName: string | null; firstName: string | null; lastName: string | null; taxNumber: string | null } | null;
  belgeTuru: string; title: string; referenceNo: string | null; period: string | null;
  issuedAt: string | null; receivedAt: string | null; createdAt: string;
  pdfVar: boolean;                  // storageKey dolu mu (ham anahtar dönmez)
  viewedAt: string | null;
  ozet: {
    kurumAciklama?: string | null; altKurum?: string | null;     // tebligat
    gonderimZamani?: string | null; tebligZamani?: string | null; okumaZamani?: string | null; // ham metin (dd/MM/yyyy HH:mm:ss)
    tebligTarihi?: string | null;   // ISO — receivedAt (tebliğ zamanı); yoksa tebligZamani'dan çevrilmiş
    tebligDurumu?: 'bekliyor' | 'yaklasiyor' | 'edildi' | null; // now<tebliğ-2g | tebliğ-2g≤now<tebliğ | now≥tebliğ
    kanunNo?: string | null; calisan?: number | null; tutar?: number | null; mahiyet?: string | null; // SGK ("690,09" → 690.09)
  };
  iletim: IletimBilgisi[];          // bu belgeyi (docRefs) içeren gönderimler, en yeni önce; yoksa []
  // yalnız birlesik=1 (SGK):
  hizmet?: { id: string; pdfVar: boolean; viewedAt: string | null } | null;
  tahakkuk?: { id: string; pdfVar: boolean; viewedAt: string | null; tutar: number | null } | null;
};
```
`raw` alanı YANITTA YOK.

## 2. `GET /portal-automation/documents/mukellefler?belgeTuru=…`
Süzgeç listesi: belgesi olan mükellefler ∪ ilgili şifresi olanlar (tebligat: `GIB_IVD`; SGK: `SGK_EBILDIRGE`).
```ts
{ rows: Array<{ id: string; ad: string; taxNumber: string | null; belgeSayisi: number; sifreVar: boolean; sifreHatasi: string | null }> }
```
`ad`e göre Türkçe sıralı.

## 3. `GET /portal-automation/summary` — EK alanlar (mevcutlar kalır)
```ts
stats.tebligatBuHaftaTeblig: number;   // receivedAt ∈ (şimdi, şimdi+7g]
credentialsBlocked: Array<{ provider: string; taxpayerId: string | null; ad: string; taxNumber: string | null; since: string | null; hata: HataBilgisi; geceSayisi: number }>;
// tebligatErrors[] ve sgkErrors[] elemanlarına EK: hata: HataBilgisi
type HataBilgisi = { tur: 'sifre' | 'guvenlik_kodu' | 'baglanti' | 'diger'; metin: string; ham: string };
// metin örnekleri: "Şifre büyük olasılıkla yanlış — 3 denemede giriş doğrulanamadı", "Güvenlik kodu çözülemedi (servis) — otomatik yeniden denenir",
//                  "Portala bağlanılamadı — otomatik yeniden denenir"
```
3 GECE KURALI: gece işi (`source='nightly'`) oluşturulurken, mükellefin ilgili şifresi `tur='sifre'` hatalıysa VE o mükellefin aynı iş tipinde son 3 işi de
aynı türde hatayla bittiyse iş AÇILMAZ, `skipped.reason='3 gece üst üste şifre hatası — şifre güncellenene kadar sorgu dışı'`. `saveCredential` (şifre
değişince) `lastError=null` yapar → ertesi gece yeniden dener. Elle "Şimdi sorgula" bu kuraldan MUAF.

## 4. `GET /beyan-kayitlari` — sayfalı mod
`page` verilirse `{ rows, total, page, pageSize }` döner; verilmezse ESKİ dizi yanıtı aynen.
Ek sorgu parametreleri (hepsi isteğe bağlı): `pageSize` (25|50|100, dışa aktarım ≤1000), `taxpayerId`, `beyanTipi` (virgülle çoklu; `KDV1,KDV2`),
`donemBas`/`donemBit` (`YYYY-MM`, yıllık kayıtlar `YYYY-YIL` → yıl olarak karşılaştırılır), `belge` (`all|beyanname|tahakkuk` = ilgili PDF'i olanlar),
`iletim` (`all|iletildi|iletilmedi|hata`), `search`, `sirala` (`yeni` varsayılan = beyanTarihi desc, createdAt desc; `donem`, `mukellef`, `tutar`).
Satır = mevcut BeyanKaydi alanları + `taxpayer` (id, companyName, firstName, lastName, taxNumber, email, emails, phone, phones) + `iletim: IletimBilgisi[]`
(docRefs bu kaydın id'sini içeren VERGI gönderimleri, en yeni önce; kanal başına en yenisi yeter).

## 5. `POST /beyan-kayitlari/gonder`
```ts
body: { ids: string[]; channel: 'WHATSAPP' | 'EMAIL' }   // en çok 50 id
yanit: { ok: true; testMode: boolean; results: Array<{ taxpayerId: string; unvan: string; channel: string; status: 'SENT' | 'FAILED'; error: string | null; kayitSayisi: number }> }
```
Kurallar: Akıllı Bildirim VERGI kategorisi ayarı `enabled=false` olsa da elle gönderim ÇALIŞIR (force); `testMode=true` ise alıcı test telefonu/e-postası
(gerçek mükellefe gitmez) ve yanıtta `testMode:true`. Aynı mükellefin kayıtları TEK demette (tek PDF birleşik + kısa link) gider; DocumentDispatch
kaydı `docRefs=ids` ile açılır/güncellenir (`force` ile yeniden gönderim). Yalnız PDF'i olan kayıtlar gider; PDF'siz id'ler `error='PDF yok'`.

## 6. Web ortak
- `apps/web/src/components/ui/Sayfalama.tsx` HAZIR: `<Sayfalama sayfa sayfaBoyutu toplam onSayfa onSayfaBoyutu birim renk yukleniyor />`,
  yardımcılar `sayfaParamOku`, `boyutParamOku`, `SayfaBoyutu`. Sayfa ve boyut adres çubuğunda `?sayfa=2&boyut=50` (Next `useSearchParams` + `router.replace`).
- Süzgeç değişince sayfa 1'e döner. Liste sorgusu `keepPreviousData/placeholderData` ile sayfa geçişinde titremez.
- İletim rozeti (üç modülde aynı): `iletim[0]` → SENT: yeşil "WhatsApp · 12 Eyl" / "E-posta · 12 Eyl"; FAILED: kırmızı "İletilemedi" (title=error); testMode: rozet ucunda "test"; yoksa rozet yok.
