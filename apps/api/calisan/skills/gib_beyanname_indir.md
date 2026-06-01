# Skill: GİB E-Beyanname Toplu İndirme (beyanname + tahakkuk PDF)

**Amaç:** ebeyanname.gib.gov.tr'den onaylı beyanname + tahakkuk PDF'lerini **tek tek tıklamadan toplu** indir.
**Model:** kritik belge → **Opus 4.8** (doğrulama/karar); liste gezme/indirme orkestrasyonu → Sonnet.
**Çalışma yolu:** Giriş captcha'lı ve elle yapılır. Ajan, **GİRİŞ YAPILMIŞ tarayıcı oturumunda** (Chrome uzantısı / yerel agent köprüsü) `/dispatch` çağrılarını yürütür; sunucu orkestreder.

## Ortam
- Tüm işlemler `https://ebeyanname.gib.gov.tr/dispatch` adresine komutla yapılır.
- **TOKEN** (oturum anahtarı) tüm `/dispatch` çağrılarında zorunlu. Giriş sonrası mevcut adreslerden al
  (`cmd=LOGIN&TOKEN=...` veya indirme linklerindeki TOKEN). **Oturum boyunca sabittir**, hepsinde aynısı.

## Adım 1 — Listeyi al
```
GET /dispatch?cmd=ARSIVBEYANNAMELISTESI&TOKEN=<TOKEN>&grupSayi=<0,25,50...>
  &beyannameTanim=<TÜR>&donemBasAy=&donemBasYil=&donemBitAy=&donemBitYil=
  &vergiNo=&tcKimlikNo=&vdKodu=
  &sorguTipiN=1&sorguTipiT=1&sorguTipiB=1&sorguTipiP=1&sorguTipiV=1&sorguTipiZ=1
  &baslangicTarihi=<YYYYAAGG>&bitisTarihi=<YYYYAAGG>&durum=0
```
- `beyannameTanim`: arama formundaki select değerleri — örn. `GGECICI` (gelir geçici), `KGECICI` (kurum geçici), `KDV1`, `MUHSGK`...
- `baslangicTarihi/bitisTarihi` = **YÜKLEME tarihi** aralığı. Dar tutarsan kayıt düşer → **geniş tut** (örn. `20260101`–bugün).
- **Sayfalama:** sonuç 25'erli gelir; üstte "1 - 25 / 136" yazar. Toplam sayıyı oradan oku, `grupSayi`'yı 0,25,50… artırarak **tüm sayfaları gez ve birleştir.**

## Adım 2 — Her satırdan numaraları çıkar
Her satırda **B** (beyanname) ve **T** (tahakkuk) ikonu var. onclick/href içinde:
`beyannameOid=<...>` ve `tahakkukOid=<...>`. Her satır için: bu ikisi + Ad/Unvan + VKN/TC topla.
(Oid kısa alfanümerik: örn. `beyannameOid=1umosqxzpz1v97`, `tahakkukOid=1vmoste6iu1h8f`)

## Adım 3 — PDF'leri doğrudan indir (TIKLAMA YOK)
```
Beyanname: GET /dispatch?cmd=IMAJ&subcmd=BEYANNAMEGORUNTULE&TOKEN=<TOKEN>&beyannameOid=<oid>&inline=true
Tahakkuk : GET /dispatch?cmd=IMAJ&subcmd=TAHAKKUKGORUNTULE&TOKEN=<TOKEN>&beyannameOid=<oid>&tahakkukOid=<toid>&inline=true
```
- Sayfa içi fetch, `credentials:'include'` (oturum çerezi + TOKEN birlikte gitsin).
- Dönen veriyi PDF/blob kaydet. Dosya adı: `<AdUnvan>_<VKN>_beyanname.pdf` ve `_tahakkuk.pdf`.

## Adım 4 — Hız sınırı (ZORUNLU)
- GİB iki görüntüleme arası **EN AZ 1 sn** ister → iki IMAJ çağrısı arası **en az 1.2 sn bekle.**
- **PARALEL ÇEKME, sıralı git.** Hızlı gidersen PDF yerine "İki görüntüleme aralığı arası en az 1 sn olabilir" uyarısı / şifreli metin döner, belge inmez.

## Adım 5 — Doğrulama / hata
- Dönen içerik PDF değilse (HTML/uyarı) o Oid'i **1.2 sn sonra tekrar dene.**
- TOKEN düşerse (oturum bitti) **DUR**; yeni girişle yeni TOKEN al, **kaldığın yerden devam.**
- **ÖNCE 2-3 kayıtla test et**; PDF'ler düzgün açılıyorsa tümüne geç.

## Portal entegrasyonu
- İndirilen PDF'ler → `beyan-kayitlari` (VKN/dönem/tip/tutar çıkarımı) ve ilgili `BeyanDurumu` güncellemesine bağlanabilir.
- Mevcut sunucu toplayıcısındaki `EBEYANNAME_DAILY_DOWNLOAD` akışıyla çakışmadan, onun yöntemini bu /dispatch mantığıyla zenginleştir.
- Öğrenme: tür bazında çalışan `beyannameTanim` değerlerini ve sık VKN'leri hafızaya yaz.
