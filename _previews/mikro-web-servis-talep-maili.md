# Mikro'ya gönderilecek e-posta — web servis (API) erişim talebi

**Kime:** info@mikro.com.tr
**Konu:** e-Portal web servis (API) erişim talebi — WASH CLEAN END. MUTFAK CİH. SAN. TİC. LTD. ŞTİ. (VKN 8001214614)

---

Merhaba,

Mali müşavirlik ofisi olarak mükelleflerimizin e-Fatura ve e-Arşiv belgelerini kendi muhasebe sistemimize otomatik aktarıyoruz. Aşağıdaki mükellefimiz e-Dönüşüm hizmetini sizden alıyor:

- **Unvan:** WASH CLEAN ENDÜSTRİYEL MUTFAK CİHAZLARI SANAYİ TİCARET LİMİTED ŞİRKETİ
- **VKN:** 8001214614
- **e-Portal hesabı:** aygenmutfak@gmail.com

Bu mükellefin belgelerini portale her ay elle girmek yerine **web servis (API) üzerinden** almak istiyoruz. Talebimiz:

Yardım merkezinizdeki "e-Mikro Portal'daki Faturaları Programa Aktarmak İstiyorum" başlıklı yazıda, e-Portal'dan kesilen faturaların Mikro programlarıyla entegre çalışmadığı ve aktarımın elle yapılması gerektiği belirtiliyor. Biz Mikro programı kullanmıyoruz; kendi muhasebe sistemimize **doğrudan servis üzerinden** almak istiyoruz. Bu nedenle sormak istediklerimiz:

1. **Web servis erişimi açılması.** İhtiyacımız olan işlevler:
   - Gelen e-Fatura listesi (tarih aralığına göre)
   - Giden e-Fatura ve e-Arşiv listesi (tarih aralığına göre)
   - Belgelerin **UBL-TR XML** olarak indirilmesi
   - (Varsa) belgenin durum bilgisi: onay / iptal / itiraz / red

2. Bunun için tarafımıza iletilmesini rica ettiğimiz bilgiler:
   - Servis adresi (WSDL ya da REST uç adresleri)
   - Web servis kullanıcı adı ve şifresi (portal giriş bilgilerinden ayrı ise)
   - Entegrasyon dokümanı / örnek istek-yanıt
   - Varsa test ortamı bilgileri
   - Ücretlendirme ve varsa sözleşme/başvuru formu
   - Bu erişim yalnız "özel entegratör sözleşmesi" ile mi veriliyor; öyleyse başvuru adımları nelerdir?

   (Not: `firma.myefatura.com.tr/EFatura/Firmbox/Firmbox.asmx` adresindeki Firmbox servisine bu hesabın bilgileriyle bağlanmayı denedik; servis "kullanıcı bulunamadı" (kod 2005) yanıtı veriyor. Anladığımız kadarıyla e-Portal hesapları bu servise tanımlı değil — bu hesap için tanımlama yapılması mümkün mü?)

3. **Alternatif olarak IP izni.** Web servis açılamıyorsa, e-Portal arayüzüne kendi sunucumuzdan bağlanmamız yeterli olacaktır. Ancak şu an sunucularımızdan yapılan giriş isteği güvenlik katmanınız tarafından **HTTP 403** ile engelleniyor (aynı istek ofis bağlantımızdan sorunsuz çalışıyor). Bu durumda aşağıdaki sabit IP adresimizin izin listesine alınmasını rica ederiz:

   - **185.184.210.153** (Türkiye, sabit IP)

   İhtiyaç duyarsanız ikinci bir sabit IP daha bildirebiliriz.

Hangi yolun mümkün olduğunu ve gereken adımları bildirirseniz memnun oluruz.

İyi çalışmalar dileriz.

**Muzaffer Ören**
Moren Mali Müşavirlik
muzaffer@morenmusavirlik.com

---

## Notlar (maile eklenmeyecek, sizin için)

- **Adres:** Mikro'nun sitesinde yayımlanan tek e-posta adresi `info@mikro.com.tr`. e-Dönüşüm/e-Portal için ayrı bir adres yayımlamamışlar.
- **Hızlandırmak isterseniz:** Çağrı merkezi **0850 225 10 10** (PBX 0212 806 45 45). Telefonda "e-Portal web servis entegrasyonu" deyip talebi kayda aldırmak, maile göre daha hızlı dönüş sağlayabilir. Ayrıca mükellefin e-Dönüşüm başvurusunu yapan **bayi/yetkili** varsa en hızlı yol odur.
- **Portalda kendiniz bakabileceğiniz yer:** Giriş yaptıktan sonra sağ üstteki hesap/ayarlar menüsünde "Web Servis", "Entegrasyon" ya da "API" başlığı var mı diye bakın. Varsa şifreyi oradan alıp bana iletmenize gerek yok — sadece "var" demeniz yeter, gerisini tarif ederim. Dışarıdan bakamıyorum çünkü portal, olmayan bir adres için bile giriş sayfasına yönlendiriyor.
- **Cevap gelince:** Web servis bilgileri gelirse yapıyı doğrudan sunucuya kurarım (Turkcell/Eczacıkart gibi, ajana gerek kalmaz). Sadece IP izni verirlerse de aynı şekilde sunucudan çeker. İkisi de olmazsa ofis bilgisayarındaki ajan üzerinden çekeriz.
