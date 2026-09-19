# Portal beyaz tema — geri dönüş kaydı

Kapsam: yalnız web arayüzü renkleri, kenarlık/gölge ve sayaç köşeleri. Yerleşim,
olaylar, muhasebe hesaplamaları, API ve veritabanı değiştirilmedi.
Fatura İşleme Merkezi ve alt adresleri eski A kapsamını kullanır.

## Tema öncesi kesin kayıt

- Git etiketi: `yedek-beyaz-tema-oncesi-2026-09-19` (uzak depoda da mevcut).
- Kaynak sürümü: `75df9355ab02c7cb18cdeb07c3c4cd5bbce41f30`.
- Önceki başarılı web yayını: `d03b6b13-4ed9-40f8-bb26-7dccbfe263e6`.
- Railway projesi: `diligent-blessing`; ortam: `production`.
- Web servisi: `exciting-forgiveness`; alan adı: `portal.morenmusavirlik.com`.

## Kullanıcı “eski haline al” dediğinde

Bu sürüm `surum-beyaz-tema-2026-09-19` etiketiyle işaretlenir. Sadece bu tema
değişikliğini geri almak için, temiz çalışma alanında:

```powershell
git revert --no-edit surum-beyaz-tema-2026-09-19
git push origin main
```

Sonraki değişikliklerle çakışma varsa bunları koruyarak çöz; `reset --hard` veya
zorla gönderim kullanma. Yayının başarılı olduğunu ve giriş ekranını doğrula.
Bu işlem veritabanını, belgeleri veya operasyon kayıtlarını geri sarmaz.

Alternatif: `MOREN_PORTAL_THEME=A` ile web servisini **yeniden derleyip yayınla**.
Kök yerleşim A'yı seçer, renk yardımcıları özgün koyu renkleri kullanır. Statik
sayfalar derleme sırasında üretildiğinden yalnız ortam değişkenini değiştirmek
veya tarayıcıyı yenilemek yeterli kabul edilmemelidir. Kesin birebir geri dönüş
için yukarıdaki tema sürümünü geri alma yöntemi tercih edilir.

## Doğrulama

- `node scripts/portal-theme-regression.cjs`
- `pnpm --filter @mali-musavir/web exec tsc --noEmit --pretty false`
- `pnpm --filter @mali-musavir/web build`
- Fatura Merkezi'ne geçince kök `data-theme=A`, panelde `D` olmalı.
- Açılır pencere, seçim listesi, klavye odağı, masaüstü ve telefon denetlenmeli.

Renk dönüşümü `portalStyle` ile yalnız görsel CSS alanlarına uygulanır; kaynak
renkler silinmez. Renk birleştirmeleri dönüşümden önce tamamlandığı için eski
saydamlık ekleri korunur. Menü/giriş ve gösterge panelinin özel renkleri ayrı,
D ile sınırlandırılmış dosyalardadır. Eski temada bu kurallar etkin değildir.
