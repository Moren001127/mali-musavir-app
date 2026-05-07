# Moren Auto Agent — Chrome Extension

Luca ve Mihsap sayfalarına Moren Agent'ı **otomatik enjekte eder**, portal'dan tek tuşla başlatma sağlar. Yer imine basma derdi yok.

## Yükleme (bir kerelik)

1. Chrome'da `chrome://extensions/` aç
2. Sağ üst → **"Geliştirici modu"** açık olsun
3. Sol üst → **"Paketlenmemiş öğe yükle"** tıkla
4. Bu klasörü seç: `apps/moren-auto-agent/`
5. Extension yüklenir, toolbar'da altın **M** ikonu görünür

## Kullanım

### Otomatik (önerilen)
- Luca veya Mihsap sekmesi açtığın anda agent **kendiliğinden başlar**
- Hiçbir tıklama gerekmez
- Her 2 dk'da bir self-healing kontrol — agent ölmüşse yeniden inject

### Toolbar ikonundan
- M ikonuna tıkla → popup açılır
- Luca / Mihsap durumlarını görür, "Hepsini Yeniden Başlat" diyebilirsin

### Portal'dan
- Portal → **Ajanlar** sayfasında "Agent Başlat" butonu
- Tıklayınca extension'a komut gider, tüm açık sekmelerde agent yeniden başlatılır

## Mevcut moren-bridge ile çakışmaz

Bu extension **ayrıdır**. Mevcut `moren-bridge` extension'ını (KDV indirmeleri için) kaldırma — yan yana çalışırlar:
- `moren-bridge`: chrome.downloads ile dosya intercept (KDV/Mizan indirme)
- `moren-auto-agent`: agent runtime auto-inject + portal kontrol

## Manifest izinleri

- `scripting` — content script + main world inject için
- `storage` — son durum cache
- `alarms` — 5dk watchdog cron
- `tabs` — açık sekmeleri tarayıp agent durumunu sorgu

Host:
- `*.luca.com.tr` — Luca tüm sürümler
- `app.mihsap.com` — Mihsap
- `*.morenmusavirlik.com` + Railway domain — runtime fetch için

`externally_connectable.matches`: `portal.morenmusavirlik.com` — portal extension'a mesaj yollar.

## Sürüm

v1.0.0 — ilk yayın
