# Sahte API modül eklentileri

Her `*.cjs` dosyası şu imzayla bir `uclar` fonksiyonu dışa aktarır ve eşleşmezse `false` döner:

```js
// scripts/mock/ornek.cjs
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/ornek/liste') return jsonGonder(res, 200, { rows: [] });
  return false;
}
module.exports = { uclar };
```

- `yol`: `/api/v1` öneki atılmış yol (ör. `/tasks`), `yontem`: GET/POST/…, `q`: sorgu parametreleri (nesne), `govde`: JSON gövde.
- `mock-api.cjs` yerleşik uçlardan sonra, 404'ten önce bu eklentileri sırayla dener; dosya her değiştiğinde otomatik yeniden yüklenir (sunucu yeniden başlatılmaz).
- Paralel çalışan tasarım ajanları `mock-api.cjs`'e DOKUNMAZ; kendi verisini buraya `<modul>.cjs` olarak ekler.

## Öncelikli eklentiler (2026-09-22): `scripts/mock/oncelik/*.cjs`
Aynı imza; **yerleşik uçlardan ÖNCE** denenir. `mock-api.cjs` içinde zaten tanımlı bir sahte ucu
(ör. `/genel-sorgular`, `/beyanname-takip/ozet`) kendi verinle ezmek istiyorsan dosyanı buraya koy.
Eşleşmeyen her şey için `false` döndür ki diğer uçlar bozulmasın.
