# Beyanname İndirme · e-Tebligat Kontrol · SGK Otomasyonu — İnceleme ve İyileştirme Önerisi (2026-09-14)

Kaynak: kod okuması + canlı veritabanı (salt okunur).

## 0. Bugünkü yük (canlı)
| Modül | Kayıt | Sayfa açılınca ne çekiliyor | Ekranda |
|---|---:|---|---|
| Beyanname İndirme | 1.145 beyan kaydı (KDV1 507, MUHSGK 358, GGECICI 138 …) | `limit=1500` → hepsi, her kayıt 2 satır (beyanname + tahakkuk) → ~2.300 satır | yalnız ilk **300 satır** çiziliyor, gerisi sessizce gizli; iş sürerken 5 sn'de bir hepsi yeniden |
| e-Tebligat | 2.567 tebligat | `limit=0` → hepsi + ham GİB satırı (`raw`, ~700 B/kayıt ≈ 2–3 MB) | istemcide 200'lük sayfa |
| SGK | 1.432 belge (716 hizmet listesi + 716 tahakkuk) | `limit=0` → hepsi + ham veri | istemcide 200'lük sayfa |

Aynı uçları mobil uygulama ve masaüstü de kullanıyor → eski uçlar aynen kalır, sayfalı YENİ uçlar eklenir.

## 1. SAYFALAMA (istenen)
- Sunucu tarafı: `page` + `pageSize` (25 / 50 / 100, varsayılan 50) + toplam sayı; arama, mükellef, tür, dönem süzgeçleri sunucuda.
- Yeni uçlar: `GET /portal-automation/documents/sayfa` (tebligat + SGK), `GET /beyan-kayitlari?page=&pageSize=` (page verilirse `{rows,total}`; verilmezse eski dizi).
- Ham `raw` alanı listede taşınmaz (yalnız gereken 3 alan: kurum, alt kurum, okuma) → tebligat sayfası 2–3 MB yerine ~50 KB.
- Ortak `Sayfalama` bileşeni: "1–50 / 2.567" · sayfa boyutu · ilk/önceki/1 2 3 …/sonraki/son; süzgeç değişince 1. sayfa; sayfa numarası adres çubuğunda (geri tuşu çalışır).
- Beyanname'de "ilk 300 satır" kesintisi ve iş sırasında tüm listeyi yeniden çekme kalkar.

## 2. TESPİTLER ve ÖNERİLER

### Beyanname İndirme
1. **Satır eylemleri gerçek gönderim değil.** E-posta/WhatsApp/SMS düğmeleri bilgisayardaki uygulamayı açıyor (`mailto:` / `wa.me` / `sms:`); PDF eklenmiyor; kayıt tutulmuyor; "hazırlandı" yazısı sayfa yenilenince kayboluyor. Toplu araç çubuğundaki "E-posta / WhatsApp" seçilenlerin yalnız İLKİNİ açıyor.
   → Portalın kendi WhatsApp köprüsü ve e-posta servisiyle **PDF ekli gerçek gönderim** (Akıllı Bildirim altyapısı `DocumentDispatch`), satırda "WhatsApp ile iletildi 12.09" rozeti, toplu seçimde gerçek toplu gönderim. SMS düğmesi kalkar (SMS ile PDF gönderilemez).
2. **"Durum" süzgeci gerçek değil.** GÖNDERİLEN/OKUNAN/SMS seçenekleri onay no ya da telefon var mı diye bakıyor (kodda "veri modelinde yok" notu). → İletim kayıtlarına bağlanır: İletilen / İletilmeyen / Hata.
3. **Her kayıt iki satır** (Beyanname + Tahakkuk) → tek satır, iki belge çipi (Beyanname PDF · Tahakkuk PDF), tutar tek yerde; liste yarıya iner, seçim kutusu kayıt başına.
4. **Süzgeç kutuları dar**: "Tüm mükell…", "Tür S…", "Durum S…" kırpılıyor; "Tür Seçiniz / Durum Seçiniz" yerine "Belge: Tümü", "İletim: Tümü".
5. **İki çekme düğmesi** ("Beyannameleri Çek" / "Yeni Beyanname Sitesinden Çek") farkı açıklanmıyor → kısa açıklama satırı, ikincisi ikincil stil.
6. Türkçe karaktersiz metinler ("Secili kayit yok", "Goruntulendi", "E-posta hazirlandi", "Mukellef") düzeltilir.

### e-Tebligat Kontrol
1. **"Gece sorgu hatası 6"** — 8 şifre kaydının hepsi aynı belirsiz metin: "CAPTCHA çözülemedi veya portal şifreyi reddetti" (Hüseyin Salı, Famcoffee, Mücahit Göktaş, Sabri Yaşın, Talha Bozoğlu, Muzaffer Ören; SGK: Erdoğan Balçık, Ramazan Çorbacı). Aynı mükellefler her gece yeniden deneniyor, her gece hata (7 günde 50 başarısız tebligat sorgusu). → Hata metni sade ve ayrık ("Şifre reddedildi" / "Güvenlik kodu çözülemedi — otomatik yeniden denenir"); 3 gece üst üste şifre hatası veren mükellef listede "şifre bekliyor" rozetiyle işaretlenir ve şifre güncellenene kadar gece sorgusundan düşer (gürültü + boşa captcha bakiyesi).
2. **Tebliğ tarihi vurgusu yok.** Tebligat gönderimden 5 gün sonra tebliğ sayılır; ekranda tarih var ama yaklaşan/dolan ayrımı yok. → "2 gün içinde tebliğ sayılacak" (sarı) / "tebliğ edildi" (gri) rozeti; üst kartlara "Bu hafta tebliğ sayılacak: N".
3. **Mükellefe iletildi mi görünmüyor** (Akıllı Bildirim e-Tebligat kategorisi çalışıyor) → satırda iletim rozeti (kanal + tarih).
4. "Okuma" sütunu neredeyse hep "—" → GİB'den okuma bilgisi gelmiyorsa sütun kalkar (kontrol edilecek).

### SGK Otomasyonu
1. **Aynı mükellef + dönem iki satır** (Hizmet Listesi / Tahakkuk Fişi) → tek satır: dönem, kanun no, çalışan, tutar, iki belge düğmesi. Liste yarıya iner.
2. Gece sorgu hatası şeridi: yukarıdaki sade/ayrık metin + "şifre bekliyor" işareti.
3. Mükellefe iletim rozeti (SGK kategorisi).
4. "Tümünü Görüntüle" tek başına sağda; sorgula/yenile/tümünü görüntüle tek şeritte toplanır.

### Ortak
- Mükellef süzgeci listesi sunucudan (bugün tüm belgelerden türetiliyor → sayfalamayla bozulur).
- Sayfalama bileşeni ve tarih/rozet stilleri üç modülde aynı.

## 3. Uygulama sırası (onaya göre)
A. Sayfalama (üç modül, yeni uçlar, ortak bileşen) — istendi.
B. Görsel/metin düzeltmeleri (süzgeç etiketleri, Türkçe karakter, düğme açıklamaları, tek şerit).
C. Tek satır birleştirme (Beyanname: beyanname+tahakkuk; SGK: hizmet listesi+tahakkuk).
D. Gerçek gönderim + iletim rozeti/süzgeci (Beyanname WhatsApp/e-posta PDF'li; e-Tebligat/SGK'da iletim rozeti).
E. e-Tebligat: tebliğ tarihi rozetleri + hata metni ayrımı + 3 gece kuralı.
