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

## Açık Modüller (geliştirme devam ediyor)
- İHO (İşletme Hesap Özeti) — Luca otomasyonu deneme aşamasında
- Mihsap Fatura İşleme — hızlandırma sürüyor
- Duyurular — yeni şablon entegrasyonu
- Bookmarklet/Agent ortak kod (mizan ve kdv kontrol için yukarıdaki ana akışlar
  hariç) — geliştirme devam ediyor

