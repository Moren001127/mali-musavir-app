# Luca Local Agent

Ofis bilgisayarında arka planda çalışan worker. Railway API'sini polling yapıp Luca'dan veri çeker.

**Neden bu yol?** Railway'in cloud IP'leri Luca tarafından bloklanıyor. Senin ofis PC'nin normal internet bağlantısı bloklanmıyor — bu worker o avantajı kullanır. Chrome'un açık olmasına gerek yok, sadece PC açık olsun.

## Bir kerelik kurulum

### 1. Node.js yükle (PC'de yoksa)

[nodejs.org/en/download](https://nodejs.org/en/download/) → Windows Installer (LTS sürümü) → indir, kur. Komut isteminde test:
```cmd
node --version
```
20.x veya 22.x görmen lazım.

### 2. Bağımlılıkları yükle

```cmd
cd C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app\apps\luca-local-agent
npm install
npx playwright install chromium
```

Playwright Chromium ~150 MB indirir.

### 3. Config dosyasını oluştur

```cmd
copy config.example.json config.json
notepad config.json
```

İçindeki dört değeri doldur:

- `api.baseUrl` — Zaten doğru, dokunma
- `api.agentToken` — Portal'a gir → **Ayarlar** → **Moren Agent** bölümünde token görünür, **Kopyala**'ya bas, buraya yapıştır
- `luca.uyeNo` — Luca müşavir/üye no
- `luca.username` — Luca kullanıcı adın
- `luca.password` — Luca paroLan

Dosyayı kaydet, kapat.

### 4. Test çalıştır

```cmd
npm start
```

Konsolda şuna benzer bir log görmen lazım:
```
[2026-05-12T18:33:00.000Z] Luca Local Agent başladı.
[2026-05-12T18:33:00.001Z] API: https://mali-musavir-app-production.up.railway.app/api/v1
[2026-05-12T18:33:00.002Z] Polling: her 30 saniyede bir
```

Bu pencereyi kapatma — agent çalışıyor.

### 5. Portal'dan hesap planı çek (test)

Web portal'a git → Bir mükellef seç → **Hesap Planları Güncelle** butonuna bas.

Agent konsolu 30 saniye içinde:
```
[...] 1 bekleyen job bulundu.
[...] İşleniyor: ACCOUNT_PLAN · ABC Şirketi · jobId=a3f2...
[...] Luca login sayfasına gidiliyor...
[...] Login başarılı: https://agiris.luca.com.tr/...
[...] Hesap planı çekiliyor: ABC Şirketi
[...] Hesap planı indirildi (24563 byte), yükleniyor...
[...] ✓ ACCOUNT_PLAN tamamlandı
```

Portal'da fatura muhasebeleştirme ekranında "Hesap seç" popup'ında o mükellefin hesap kodları görünür.

## Arka planda otomatik başlat (Windows Service olarak)

Her seferinde `npm start` yazmamak için Windows servis yap:

### Yöntem 1 — Task Scheduler (basit)

1. Windows tuşu → "Görev Zamanlayıcı" yaz, aç
2. Sağda **Görev Oluştur**
3. **Ad**: `Luca Local Agent`
4. **Tetikleyiciler** sekmesi → Yeni → **Oturum açıldığında**
5. **Eylemler** sekmesi → Yeni → 
   - **Program**: `C:\Program Files\nodejs\node.exe`
   - **Argümanlar**: `src\agent.js`
   - **Başlat (isteğe bağlı)**: `C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app\apps\luca-local-agent`
6. **Koşullar** → "AC gücü gerektirir" tikini KALDIR
7. Tamam. PC'yi yeniden başlat, kendiliğinden çalışır.

### Yöntem 2 — PM2 (daha güçlü, dashboard'lu)

```cmd
npm install -g pm2 pm2-windows-service
pm2-service-install
pm2 start src/agent.js --name luca-agent
pm2 save
```

Sonra `pm2 logs luca-agent` ile loglara bak, `pm2 restart luca-agent` ile yeniden başlat.

## Sorun giderme

**"CAPTCHA ekranı geldi" hatası:**
İlk kez Luca'ya logout durumdan giriyorsan bazen CAPTCHA çıkar. Bir kez tarayıcı ile manuel login ol, oturum aç, sonra agent'i tekrar çalıştır. Luca cookie'leri 1-2 gün aktif kalır.

**"Login başarısız" hatası:**
- `config.json` içindeki uyeNo / username / password doğru mu kontrol et
- Luca tarafında parola değişti mi
- Browser console hatası için config'de `"headless": false` yap, ekranda ne olduğunu gör

**"Polling hatası 401" / 403:**
Agent token geçersiz veya süresi dolmuş. Portal → Ayarlar → Moren Agent → "Yeni Token Üret" ile yenisini al.

**Job hiç gelmiyor:**
Portal'da "Hesap Planları Güncelle" butonuna basıldığında DB'de pending job oluşuyor mu, kontrol et. Agent token aynı tenant'a mı bağlı?

## Güvenlik notu

`config.json` içinde Luca paroLan açık olarak duruyor. Bu dosyayı:
- Git'e commit ETME (`.gitignore`'a eklendi)
- Başkasıyla paylaşma
- USB'ye kopyalama, sadece bu PC'de kalsın

Daha güvenli olması için ileride Windows Credential Manager veya encrypted-config eklenebilir.
