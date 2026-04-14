# Yerel Ajan Entegrasyonu

Yerel bilgisayarda çalışan Python ajanları (Luca, Mihsap, ...) olayları
portal'a HTTPS ile gönderir.

## 1. Ortam değişkenleri (API)

API sunucusunun ENV'ına ekleyin:

```
AGENT_INGEST_TOKENS="<tenantId>:<rastgele_token>"
```

Birden fazla tenant varsa virgülle ayırın:
```
AGENT_INGEST_TOKENS="tenant1:tok1,tenant2:tok2"
```

Token üretimi (terminalde):
```bash
openssl rand -hex 32
```

## 2. Prisma migration

```bash
cd apps/api
pnpm prisma migrate dev --name agent_events
# veya production:
pnpm prisma migrate deploy
pnpm prisma generate
```

## 3. Yerel script'ten bağlanma

Her ajan script'ine `portal_gonder.py` helper'ı import edilir.
`C:\Users\moren\MOREN-Agents\portal_gonder.py` dosyasına şunu kaydedin:

```python
"""MOREN Portal'a olay gönderen küçük helper."""
import os, json, urllib.request, urllib.error

API_BASE = os.environ.get("MOREN_API_BASE", "https://api.morenmusavirlik.com/api/v1")
AGENT_TOKEN = os.environ.get("MOREN_AGENT_TOKEN", "")

def log_event(agent, status, **fields):
    """Olayı portal'a gönder. Ağ hatası olursa sessizce geç."""
    if not AGENT_TOKEN:
        return
    payload = {"agent": agent, "status": status, **fields}
    try:
        req = urllib.request.Request(
            f"{API_BASE}/agent/events/ingest",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Agent-Token": AGENT_TOKEN},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:
        # Log ama crash etme
        print(f"[portal_gonder] HATA: {e}")

def ping_status(agent, running=None, hedef_ay=None, meta=None):
    if not AGENT_TOKEN:
        return
    payload = {"agent": agent}
    if running is not None: payload["running"] = running
    if hedef_ay: payload["hedefAy"] = hedef_ay
    if meta: payload["meta"] = meta
    try:
        req = urllib.request.Request(
            f"{API_BASE}/agent/status/ping",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Agent-Token": AGENT_TOKEN},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:
        print(f"[portal_gonder] ping HATA: {e}")
```

Windows kullanıcı ENV (PowerShell):

```powershell
[Environment]::SetEnvironmentVariable("MOREN_API_BASE", "https://api.morenmusavirlik.com/api/v1", "User")
[Environment]::SetEnvironmentVariable("MOREN_AGENT_TOKEN", "BURAYA_TOKEN", "User")
```

## 4. Örnek kullanım (Luca)

`luca_earsiv_tasiyici.py` içinde:

```python
import sys
sys.path.insert(0, r"C:\Users\moren\MOREN-Agents")
from portal_gonder import log_event, ping_status

# Başlangıçta:
ping_status("luca", running=True, hedef_ay="2026-03")

# Her ZIP taşındığında:
log_event(
    "luca", "basarili",
    mukellef="EDELER YEM",
    message="ZIP taşındı ve açıldı",
    meta={"dosya": zip_path.name, "html_kalan": 44},
)

# Kapatılırken:
ping_status("luca", running=False)
```

## 5. Mihsap için (tarayıcı eklentisi / userscript)

Mihsap tarayıcı üzerinden çalıştığı için yerel Python yerine **Chrome
userscript** ile POST atılır. `mihsap_tampermonkey.user.js` dosyası
hazırlanacak (sonraki sürüm).

## 6. UI sayfaları

- `/panel/ajanlar` — ajan listesi + canlı durum
- `/panel/ajanlar/loglar` — filtrelenebilir canlı log akışı
- `/panel/ajanlar/profiller` — mükellef bazlı hesap kodu kuralları editörü
