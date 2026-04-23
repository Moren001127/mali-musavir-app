# Moren HGS Agent

KGM İhlal Takip sitesinde plaka sorgusu yapan Node.js + Playwright agent'ı.
Portal'daki "Toplu Sorgula" butonu AgentCommand yazar, bu script o komutu alıp otomatik sorgu yapar.

## Kurulum (bir kere)

```powershell
cd hgs-agent
npm install
npx playwright install chromium
```

## Ayarlar

`.env` dosyası oluştur:

```
PORTAL_URL=https://mali-musavir-app-production.up.railway.app/api/v1
AGENT_TOKEN=<portaldan admin'den alınan agent token>
```

## Çalıştırma

```powershell
cd hgs-agent
node hgs-agent.js
```

Chromium penceresi açılır. Portalda "Toplu Sorgu Başlat"a bastığında:
1. Script komutu görür
2. Her plaka için KGM sitesine gider, plakayı otomatik doldurur
3. **Captcha pencerede görünür — sen çözer ve SORGULA'ya basarsın**
4. Sonuç tablosu parse edilir, portala yazılır
5. Tüm plakalar bitince komut "done" olarak işaretlenir

## Sorun Giderme

- **"AGENT_TOKEN eksik"** → `.env` dosyasını kontrol et
- **"Plaka input bulunamadı"** → KGM sitesinin HTML yapısı değişmiş olabilir, script'i güncelle
- **Captcha gelmezse** → Script beklemeden geçer, `detaylar: []` olarak yazılır
- **Sonuç çok uzun sürüyor** → Timeout 120 saniye, captcha'yı içinde çöz
