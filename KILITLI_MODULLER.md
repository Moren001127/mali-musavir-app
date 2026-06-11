# KİLİTLİ MODÜLLER

Bu dosyadaki modüller **kullanıcı tarafından tamamlanmış** ve **dokunulmaz**.
Claude bu modüllerdeki dosyalara değişiklik yapmadan önce kullanıcıdan
**EXPLICIT onay** almalıdır. Kullanıcı "evet, dokunabilirsin" demeden hiçbir
edit yapılamaz.

## Kurallar
1. Bu listeye dosya eklemek için kullanıcı **"X modülünü kilitle"** demeli.
2. Çıkarmak için **"X modülünün kilidini kaldır"** demeli.
3. Aynı dosya başka bir modüldeki değişiklik nedeniyle dokunulması gerekiyorsa,
   önce kullanıcıdan onay alınacak.
4. Push betiği bu dosyaları her zaman `git add` etmeyi sürdürecek (pratiklik için);
   asıl koruma Claude'un edit yapmamasıdır.

## Kilitli Modüller

### Mizan
- `apps/web/src/app/(panel)/panel/mizan/page.tsx`
- `apps/api/src/mizan/` (tüm klasör)
- Agent içinde Mizan ile ilgili kod (`fetchLucaMuavinExcel`, MIZAN job tipi handling)

### KDV Kontrol
- `apps/web/src/app/(panel)/panel/kdv-kontrol/page.tsx`
- `apps/api/src/kdv-control/` (tüm klasör)
- Agent içinde KDV_191/KDV_391/ISLETME_GELIR/ISLETME_GIDER tipleri için kod

### e-Arşiv / e-Fatura (Luca veri çekme) — 2026-06-08 kilitlendi (çalışıyor)
- `apps/web/src/app/(panel)/panel/e-arsiv/page.tsx`
- `apps/api/src/earsiv/` (tüm klasör — parser dahil; özellikle `parseTagValue:false`)
- Agent içinde e-arşiv sürüş + upload akışı (agent-runtime.js: `fetchLucaEarsivZip`, `upload-earsiv`)

### Luca Agent Çalıştırma (çalışan hâl) — 2026-06-08 kilitlendi
- `apps/luca-local-agent/src/agent.js` — **HEADLESS varsayılanı HEADFUL kalmalı** (asla headless yapma; Luca frameset headless'ta açılmıyor = kronik frame-stuck'ın sebebiydi). Watchdog/bellek/slot-kilit ayarları da korunur.
- `apps/luca-local-agent/config.json`: `"headless": false`
- `apps/luca-local-agent/scripts/start-agent.ps1` (başta `git pull` oto-güncelleme + tek-wrapper mutex)
- NOT: bu dosyalar production'da çoklu makinede canlı; değişiklik onay + test ister.

### Luca İzolasyon + Susturma + Otomatik Giriş — 2026-06-11 kilitlendi
Kullanıcı talebi: Luca verisi YALNIZ ayrı/izole yerel ajan tarayıcısından çekilsin;
kullanıcının kendi tarayıcısında Luca arka planda çalışmasın; ayrı tarayıcıya
kazara müdahale edilemesin. Koruma testi: `scripts/luca-isolation-regression.cjs`
(pre-commit'te çalışır). Bozulursa commit kesilir.
- **Eklenti Luca'da SESSİZ** — `agent-runtime.js`: `lucaSilencedInBrowserExt()`
  (DEV-* + Luca origin → iş yoklamaz, oto-giriş/captcha denemez, oturum eşitlemez,
  panel göstermez). Yerel ajan (moren-*) ETKİLENMEZ. Acil aç: `window.__morenLucaExtEnable=true`.
- **Otomatik giriş (captcha)** — `apps/luca-local-agent/src/agent.js` `loginToLuca`:
  Luca artık 2FA kapalı hesapta girişte CAPTCHA zorunlu. Doğru akış: kimlik gir →
  `girisbtn()` → captcha sayfasında `#captcha` 2captcha ile çöz (regsense:1) →
  `#captcha-input` → Tamam/`forms[0].submit` → main.erp. `.env`'de `TWOCAPTCHA_API_KEY` şart.
- **Ayrı tarayıcı küçük/kilitli** — `scripts/pencere-kucult-gozcu.ps1` ajanın
  `.browser-data` Chromium penceresini sürekli küçültür (kullanıcı Chrome'una dokunmaz);
  `start-agent.ps1` bu gözcüyü başlatır.

## Açık Modüller (geliştirme devam ediyor)
- İHO (İşletme Hesap Özeti) — Luca otomasyonu deneme aşamasında
- Mihsap Fatura İşleme — hızlandırma sürüyor
- Duyurular — yeni şablon entegrasyonu
- Bookmarklet/Agent ortak kod (mizan ve kdv kontrol için yukarıdaki ana akışlar
  hariç) — geliştirme devam ediyor

