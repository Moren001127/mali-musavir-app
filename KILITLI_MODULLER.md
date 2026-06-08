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

## Açık Modüller (geliştirme devam ediyor)
- İHO (İşletme Hesap Özeti) — Luca otomasyonu deneme aşamasında
- Mihsap Fatura İşleme — hızlandırma sürüyor
- Duyurular — yeni şablon entegrasyonu
- Bookmarklet/Agent ortak kod (mizan ve kdv kontrol için yukarıdaki ana akışlar
  hariç) — geliştirme devam ediyor

