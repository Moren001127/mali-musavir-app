# Ajan anahtar geçişi — adım adım yönerge

**Neden:** Ajanlar bugüne kadar **ofis kısa adını** güvenlik anahtarı olarak kullanıyordu. Kısa ad,
ofis adından türeyen ve halka açık bir bilgi. Bu yolla `agent/luca/credential` ucu **Luca kullanıcı adı
ve parolasını açık metin** döndürüyor. (Denetim bulgusu 01, 25 Eylül 2026.)

**Durum:** Sunucu tarafı hazır (`68e901b`). Kısa ad yolu hâlâ **kabul ediliyor** — ajanlarınız dursun
diye kapatmadım. Bu yönergedeki adımlar bitince tek satırlık bir değişiklikle kapatacağım.

**Ne kadar sürer:** Bilgisayar başına 3-5 dakika. Tarayıcı eklentisi için hiçbir şey yapmanıza gerek yok.

---

## Adım 0 — Önce şunu bilin: eklenti kendiliğinden geçiyor

Tarayıcı eklentisi (bookmarklet / Moren Agent) anahtarı portaldan alıyor. Portal ekranlarından
(e-Arşiv, Mizan, KDV Kontrol) ajanı her uyandırışınızda **yeni gerçek anahtar** otomatik yükleniyor.

Yani **elle yapılacak iş yalnız yerel ajanda** (`luca-local-agent` — Luca'yı ayrı tarayıcıda süren
arka plan uygulaması).

---

## Adım 1 — Gerçek anahtarı alın (bir kez, tek bilgisayarda)

1. Portala **yönetici** hesabıyla girin (anahtar artık yalnız yönetici ve personele gösteriliyor).
2. **Ayarlar** ekranını açın, ajan kurulumu bölümüne gidin.
3. Orada görünen **ajan anahtarını** kopyalayın.

**Anahtarı nasıl tanırsınız:** Ofis adınıza benzeyen kısa bir metin **değil**, rastgele görünen uzun
bir dizi olmalı. Ofis adınıza benziyorsa sunucu henüz yeni sürüme geçmemiştir — birkaç dakika bekleyip
sayfayı yenileyin.

**"Kurulum eksik" yazıyorsa:** Bu ofis için sunucuda anahtar tanımlı değil demektir. Bana söyleyin,
tanımlanması gerekir. **Bu durumda eski kısa adı kullanmaya devam etmeyin.**

> Anahtar bir parola gibidir. WhatsApp'tan, e-postadan göndermeyin; ekran görüntüsü almayın.

---

## Adım 2 — Her bilgisayarda yerel ajanı güncelleyin

Luca ajanının kurulu olduğu **her bilgisayarda** şunu yapın:

1. Ajanı durdurun (ajan penceresini kapatın ya da başlatma betiğini sonlandırın).
2. Şu dosyayı bir metin düzenleyiciyle açın:
   ```
   apps/luca-local-agent/config.json
   ```
3. İçinde şuna benzeyen bir bölüm var:
   ```json
   "api": {
     "agentToken": "buraya-eski-kisa-ad-yaziyor"
   }
   ```
4. `agentToken` değerini **Adım 1'de kopyaladığınız gerçek anahtarla** değiştirin. Tırnakların içinde
   kalsın, başında/sonunda boşluk olmasın.
5. Dosyayı kaydedin.
6. Ajanı yeniden başlatın (`scripts/start-agent.ps1`).

**Dikkat:** Bu dosyada `headless` ayarı `false` olmalı — ona dokunmayın. Luca headless kipte açılmıyor.

---

## Adım 3 — Çalıştığını doğrulayın

Her bilgisayarda ajanı başlattıktan sonra:

1. Ajan penceresinde **"Luca'ya giriş yapıldı"** benzeri normal akışı görmelisiniz.
2. Portalda bir Luca işi başlatın (örneğin Mizan çekme) ve işin **ilerlediğini** görün.
3. Hata alırsanız (`401`, `Invalid agent token`, `Missing X-Agent-Token`): anahtar yanlış
   kopyalanmıştır. Adım 2'yi tekrarlayın; baş/son boşluk ve eksik karakter olmadığından emin olun.

**Geri dönüş:** Bir şey ters giderse `config.json`'daki eski değeri geri yazıp ajanı yeniden başlatın —
kısa ad yolu hâlâ açık olduğu için ajan eskisi gibi çalışmaya devam eder. Yani bu geçiş **geri alınabilir**.

---

## Adım 4 — Bana haber verin

Bütün bilgisayarlar geçtiğinde söyleyin. Ben şunları yapacağım:

1. **Sunucu kaydını kontrol edeceğim.** Kısa ad her kullanıldığında `[AGENT-TOKEN] ESKİ YOL` uyarısı
   düşüyor. Bu uyarı artık gelmiyorsa geçiş gerçekten tamamlanmış demektir — sizin "bitti" demenize
   güvenmek yerine kayda bakacağım.
2. Uyarı kesilmişse **kısa ad yolunu kapatacağım** (tek satırlık değişiklik, hazır bekliyor).
3. Ardından hassas uçları sıkı kipe alacağım — o noktadan sonra Luca parolasını döndüren uç yalnız
   gerçek anahtarla açılır.

---

## Sık sorulanlar

**Eski anahtar hemen geçersiz mi oluyor?**
Hayır. Geçiş bitene kadar ikisi de çalışıyor. Bu yüzden bilgisayarları tek tek, acele etmeden
geçirebilirsiniz.

**Bir bilgisayarı atlarsam ne olur?**
O bilgisayar çalışmaya devam eder ama kayıtta uyarı düşmeye devam eder ve ben kapatma adımını
yapamam. Adım 4'teki kontrol tam bunun için var.

**Mükellef verilerine bir şey oluyor mu?**
Hayır. Bu yalnız ajanın sunucuya kendini tanıtma biçimi. Fatura, mizan, beyanname verilerine
dokunulmuyor.

**Luca parolam değişiyor mu?**
Hayır. Luca kullanıcı adı ve parolanız aynı kalıyor. Değişen, ajanın **portala** bağlanırken
kullandığı anahtar.

---

## EK — 25 Eylül 2026 ölçümü: iş sandığımızdan KÜÇÜK

Sunucudan okudum, durum şu:

**Yerel ajan TEK yerde çalışıyor: `vps-radore-luca-operator` (Radore VPS).**
Son 30 günde ping atan 7 cihazın altısı tarayıcı eklentisi (sürüm `1.47.x`) —
onlar anahtarı portaldan kendiliğinden alıyor, **hiçbir şey yapmanıza gerek yok.**
Yalnız VPS'teki `local-1.1.8` sürümü elle geçirilmeli.

**Muzaffer Bey'in bilgisayarındaki `config.json` (25.09.2026) GEÇİRİLDİ** — ama o makinede
ajan çalışmıyor, yani etkisi yok; yine de doğru anahtarla duruyor. Eski değer
`config.json.eski-anahtar.yedek` dosyasında.

**Ofisler ve anahtarlar:**

| Ofis | Mükellef | Fatura | Ajan | `AGENT_INGEST_TOKENS` |
|---|---|---|---|---|
| Moren Mali Musavirlik | 1 | 0 | hiç yok | **anahtar YOK** |
| Moren Mali Musavirlik 2 | 177 | 26.747 | etkin | anahtar VAR (32 karakter) |

Birinci ofis atıl. Çalışan ofisin anahtarı zaten tanımlı, yani **yeni anahtar
tanımlanmasına gerek yok** — yönergenin "Kurulum eksik" uyarısı bu ofis için geçerli değil.

## EK — Kapatmaya ne zaman hazırız (artık ölçülebiliyor)

Uyarı eskiden anahtar başına **süreç ömrü boyunca bir kez** basılıyordu. O yüzden kayıtta
"1 uyarı" görmek hiçbir şey söylemiyordu: 30 saniyede bir yoklayan bir ajan da, tek seferlik
bir istek de aynı tek satırı üretiyordu. Sayaç eklendi:

```
[AGENT-TOKEN] ESKİ YOL: ...                      ← ilk kullanımda bir kez
[AGENT-TOKEN] ESKİ YOL HÂLÂ KULLANILIYOR: ofis … · sunucu açılışından beri 25 kez.
                                                  ← her 25 kullanımda bir
```

**Kapatma ölçütü:** sunucu yeniden başlatıldıktan sonra bu satırlar hiç çıkmıyorsa geçiş
gerçekten bitmiştir. Çıkmaya devam ediyorsa bir yerde eski anahtar hâlâ kullanılıyordur ve
kapatmak o ajanı durdurur.
