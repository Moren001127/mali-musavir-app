# Görev: Luca Local Agent Windows Servis Onarımı

## Bağlam

- `apps/luca-local-agent` altında Node.js + Playwright tabanlı bir background worker var (`src/agent.js`).
- Agent elle `npm start`, `baslat.bat` veya `start-hidden.vbs` ile çalıştırıldığında sorunsuz çalışıyor — `agent-debug.log` ve `agent.current.out.log` doluyor, joblar dönüyor.
- Agent **Windows servis olarak** (Task Scheduler veya pm2-windows-service/nssm ile) otomatik başlatıldığında patlıyor.
- Hata `apps/luca-local-agent/agent.service.err.log` içinde sürekli tekrar ediyor:

  ```
  '""C:\Program' is not recognized as an internal or external command,
  operable program or batch file.
  ```

- `agent.service.out.log` 0 byte → Node hiç başlamıyor.
- Sebep: servis launcher'ı `C:\Program Files\nodejs\node.exe` path'ini çift tırnak içine sarılmış halde cmd.exe'ye veriyor (`""C:\Program Files\..."""`), cmd dış tırnakları soyup boşlukta split ediyor.

## Çoklu PC notu (KRİTİK)

Bu agent **birden fazla bilgisayarda** kullanılıyor. Hazırlanacak script **tamamen taşınabilir** olmalı:

- Hiçbir yere `C:\Users\moren\...` veya makineye özel sabit path yazma.
- Node yolunu `where.exe node` ile bul; bulamazsa fallback olarak `C:\Program Files\nodejs\node.exe` ve `C:\Program Files (x86)\nodejs\node.exe` dene.
- Agent klasörünü scriptin kendi konumundan (`$PSScriptRoot` / `%~dp0`) türet.
- Kullanıcı adını, makine adını veya disk harfini referans alma.
- Aynı `.bat` farklı kullanıcı / farklı disk / farklı repo konumu olan başka PC'lerde de değiştirilmeden çalışmalı.

## Yapılacaklar

### 1. `apps/luca-local-agent/scripts/install-service.ps1`

Bu PowerShell scripti:

- Yönetici (Administrator) olarak çalışıyor mu kontrol etsin, değilse uyarıp çıksın.
- Varsa eski "Luca Local Agent" Task Scheduler görevini `schtasks /Delete /TN "Luca Local Agent" /F` ile silsin.
- Node.js yolunu otomatik bulsun: önce `where.exe node` çıktısı, bulamazsa fallback olarak `C:\Program Files\nodejs\node.exe` ve `C:\Program Files (x86)\nodejs\node.exe` kontrol etsin. Hiçbiri yoksa "Node.js bulunamadı, önce kur" diye uyarıp çıksın.
- Yeni görevi `Register-ScheduledTask` ile oluştursun:
  - **Trigger:** kullanıcı oturum açtığında (AtLogOn)
  - **Action:** `wscript.exe` + argüman `start-hidden.vbs` (tırnak/boşluk derdi olmasın diye VBS launcher kullanılacak)
  - **WorkingDirectory:** scriptin bulunduğu klasörün parent'ı (`apps/luca-local-agent`) — `$PSScriptRoot`'tan türet, hardcode etme
  - **Settings:** AC gücü gerektirmesin (`-DontStopIfGoingOnBatteries`, `-AllowStartIfOnBatteries`), `-StartWhenAvailable`, `-ExecutionTimeLimit` sıfır (süresiz çalışsın).
- Görev oluştuktan sonra `Start-ScheduledTask -TaskName "Luca Local Agent"` ile bir kere tetiklesin ve kullanıcıya "Kuruldu, çalışıyor" mesajı bassın.
- PowerShell içinde path'leri **kendin tırnaklamasın** — `Register-ScheduledTask`'ın `-Argument` parametresine string olarak ver, cmdlet doğru escape eder. `schtasks` kullanıyorsan `/TR` argümanını tek bir string olarak ver, içinde sadece `start-hidden.vbs` geçsin, ekstra çift tırnak ekleme.

### 2. `apps/luca-local-agent/scripts/uninstall-service.ps1`

- "Luca Local Agent" görevini varsa sil, yoksa "zaten yok" mesajı bassın.
- Çalışan `node.exe` process'lerinden `agent.js` argümanı içerenleri kibarca öldür (`Get-CimInstance Win32_Process` + `Terminate`), kullanıcının başka Node işine dokunma.

### 3. `apps/luca-local-agent/scripts/onar-servis.bat`

Batch wrapper. İçinde tek satır:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-service.ps1"
```

Kullanıcı bu `.bat` dosyasına sağ tık → "Yönetici olarak çalıştır" diyince servis sıfırdan doğru kurulsun.

### 4. `apps/luca-local-agent/README.md` güncellemesi

"Arka planda otomatik başlat" bölümünü güncelle:

- "Yöntem 1 — Task Scheduler (basit)" başlığının altındaki **manuel** adımları silme.
- Üstüne yeni bir **"Yöntem 0 — Tek tıkla onarım/kurulum (önerilen)"** bölümü ekle:
  > `scripts\onar-servis.bat` dosyasına sağ tıkla → Yönetici olarak çalıştır. Eski servisi siler, yenisini doğru kurar, hemen başlatır. Birden fazla PC'de kullanıyorsan her PC'de bir kere bu dosyayı çalıştırman gerek.
- Manuel adımların altına bir **UYARI kutusu** ekle:
  > ⚠️ Program ve Başlat alanlarına **tırnak işareti EKLEME**. Boşluklu pathleri Windows kendisi yönetir. Tırnak eklersen `'""C:\Program' is not recognized...` hatası alırsın.

### 5. Temizlik

- `apps/luca-local-agent/agent.service.err.log` ve `apps/luca-local-agent/agent.service.out.log` dosyalarını **silme**, sadece içeriklerini boşalt (truncate) ki yeni servis temiz log üretebilsin.
- `.gitignore`'a bak: bu `.log` dosyaları zaten ignore'da değilse ignore'a ekle.

### 6. Bittiğinde

Değişiklikleri özet halinde göster:

- hangi dosyalar oluştu/değişti
- kullanıcının her PC'de ne yapması gerektiği (3 satır)
- olası takılma noktaları (örn. UAC onayı, ExecutionPolicy)

## Dokunma

- `src/agent.js` — kod sağlam, dokunma.
- `config.json`, `baslat.bat`, `start-hidden.vbs` — dokunma.
- Job hatalarıyla (EARSIV_ALIS failed vb.) ilgilenme, ayrı konu.
- `.browser-data-*` klasörleri, `.device-id` dosyası — dokunma, makineye özel.
