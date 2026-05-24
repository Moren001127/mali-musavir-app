# Moren HGS Agent

KGM İhlal Takip sitesinde plaka sorgusu yapan Node.js + Playwright agent'ı.
Portal'daki "Toplu Sorgula" butonu **veya** her Pazartesi 08:00 cron'u
AgentCommand yazar; bu script o komutu alıp **2captcha ile captcha'yı
otomatik çözerek** sorgu yapar.

## Kurulum (bir kere)

```powershell
cd hgs-agent
npm install
npx playwright install chromium
```

## Ayarlar

`.env` dosyası oluştur (örnek için `.env.example`):

```
PORTAL_URL=https://mali-musavir-app-production.up.railway.app/api/v1
AGENT_TOKEN=<portaldan admin'den alınan agent token>
TWOCAPTCHA_API_KEY=<2captcha.com hesabından — Settings > API Key>
HEADLESS=true
```

> ⚠ **Güvenlik:** `.env` dosyası `.gitignore` ile dışlanmıştır. **Asla commit etmeyin.**
> 2captcha anahtarı kazara açığa çıkarsa, 2captcha panelinden anahtarı rotate edin.

## Çalıştırma

```powershell
cd hgs-agent
node hgs-agent.js
```

`HEADLESS=true` ise arka planda çalışır (ofis bilgisayarı kapanmadıkça
sürekli). `HEADLESS=false` debug için Chromium penceresini gösterir.

## Otomatik tetik

- **Her Pazartesi 08:00 TR** → API'deki `HgsCron` (`apps/api/src/schedule/hgs.cron.ts`)
  tüm tenant'lar için `AgentCommand(agent="hgs", action="toplu-sorgu")` yazar.
- Bu script her 5 saniyede bir kuyruğu kontrol eder, komut görünce işler.

## Manuel tetik

- Portal: **Galeri > HGS İhlal** sayfasında **"🔄 Toplu Sorgu Başlat"** butonu.
- Aynı AgentCommand yazılır, agent yine claim eder.

## Akış

1. Script başlar → portala ping atar (her 15s) → "canlı" görünür.
2. AgentCommand kuyruğunda HGS komutu görünür.
3. Her plaka için:
   - KGM sitesine gider, plaka input'u doldurur.
   - Captcha img'i screenshot alır, base64'e çevirip 2captcha'ya gönderir.
   - Dönen çözümü kod input'una yazar.
   - Sorgula butonuna basar.
   - Sonuç tablosunu parse eder, portal API'sine yazar.
   - Captcha yanlış geldiyse 1 kez retry (2captcha'da "bad captcha" raporlanır → ücret iadesi).
4. Tüm plakalar bitince komut `done` olarak kapanır.

## Maliyet

2captcha image captcha çözümü ortalama **0.001-0.003 USD / captcha**.
Ofiste 100 araç varsa haftalık ~$0.30, aylık ~$1.20. Yıllık tahmin: **~$15**.

## Sorun Giderme

| Hata | Çözüm |
|---|---|
| `AGENT_TOKEN eksik` | `.env` dosyasını kontrol et |
| `TWOCAPTCHA_API_KEY eksik` | `.env` dosyasını kontrol et |
| `2captcha hatası: ERROR_ZERO_BALANCE` | 2captcha hesabına bakiye yükle |
| `Plaka input bulunamadı` | KGM site yapısı değişmiş — script selector listesini güncelle |
| `2 deneme captcha yanlış geldi` | Captcha resmi kalitesi düşük olabilir; HEADLESS=false ile debug et |
| Sonuç gelmedi (30sn) | KGM yavaş veya yapay zeka rate-limit; tekrar dene |

## Bağımlılıklar

- `playwright` + `playwright-core` — tarayıcı otomasyonu
- `2captcha` — captcha çözüm servisi npm sarmalı
