# Uyumsoft'a gönderilecek e-posta — web servis erişimi + IP izni

**Kime:** Uyumsoft destek / müşteri temsilciniz (destek talebi olarak da açılabilir)
**Konu:** e-Fatura web servis (BasicIntegration) erişimi — SULTAN OSMAN İNŞAAT SAN. VE TİC. LTD. ŞTİ. (VKN 6481710811)

---

Merhaba,

Mali müşavirlik ofisi olarak mükelleflerimizin e-Fatura belgelerini kendi muhasebe sistemimize otomatik aktarıyoruz. Aşağıdaki mükellefimiz e-Fatura hizmetini sizden alıyor:

- **Unvan:** SULTAN OSMAN İNŞAAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ
- **VKN:** 6481710811
- **Portal kullanıcı adı:** SultanOsman

`http://efatura.uyumsoft.com.tr/Services/BasicIntegration` adresindeki **BasicIntegration** servisine `GetInboxInvoicesData` çağrısı yaptığımızda şu yanıtı alıyoruz:

> `Bu sisteme erişmek için gerekli yetkiniz yok, Kullanıcı: SultanOsman, Ip: 185.184.210.153`

İki farklı çıkış adresimizden de aynı yanıt geliyor. Bu nedenle sormak istediklerimiz:

1. **Web servis kullanıcısı.** Anladığımız kadarıyla portal kullanıcısı ile web servis kullanıcısı farklı olabiliyor. Bu mükellef için **web servis kullanıcı adı ve şifresi** tanımlı mı? Tanımlı değilse oluşturulmasını, tanımlıysa tarafımıza iletilmesini rica ederiz.

2. **IP izni.** Erişim IP kısıtlıysa aşağıdaki iki sabit adresimizin izin listesine alınmasını rica ederiz:
   - **185.184.210.153** (Türkiye, sabit IP)
   - **162.220.234.15** (uygulama sunucumuz)

3. **Yetki.** Bu kullanıcıya **gelen kutusu (GetInboxInvoicesData)** ve **giden kutusu (GetOutboxInvoicesData)** okuma yetkisi verilmesini rica ederiz. Belgeleri yalnız okuyup muhasebeleştiriyoruz; gönderim/iptal işlemi yapmıyoruz.

Gerekirse entegrasyon dokümanınızı ve varsa test ortamı bilgilerini de iletmenizi rica ederiz.

İyi çalışmalar dileriz.

**Muzaffer Ören**
Moren Mali Müşavirlik
muzaffer@morenmusavirlik.com

---

## Notlar (maile eklenmeyecek, sizin için)

- **En olası sebep:** Uyumsoft aktivasyon e-postasında **iki ayrı kullanıcı** gönderiyor: biri portal girişi, diğeri **web servis** kullanıcısı. Elimizdeki "SultanOsman" büyük ihtimalle portal kullanıcısı. Eski aktivasyon e-postasını bulabilirseniz web servis kullanıcı adı/şifresi oradan çıkar ve maile gerek kalmaz — bilgileri entegratör kartına girip "Sorgula" demeniz yeterli.
- **Teknik taraf hazır:** Sunucudan Uyumsoft'a erişim sorunu çözüldü (aşağıda). Kalan tek şey yetki/kullanıcı.
- Hata mesajı hem yanlış kullanıcıda hem yetkisiz kullanıcıda aynı çıkıyor (sahte kullanıcıyla denedim, aynı metin), yani mesajdan şifrenin doğru olup olmadığı anlaşılmıyor.
