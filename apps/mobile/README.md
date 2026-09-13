# MOREN Müşavir — Mobil Uygulama (iOS + Android)

Portalın telefon uygulaması. **WebView hibrit** (Muzaffer Bey kararı 2026-07-27): onaylanan tasarım HTML'i olduğu gibi
tam ekran gösterilir; yerel özellikler (kamera/belge tarayıcı, Face ID, dokunsal geri bildirim, anlık bildirim)
`app/index.tsx` köprüsüyle eklenir. Tasarımı elle React Native'e çevirme denemesi piksel-piksel tutmadığı için bırakıldı.

## Dosya düzeni
| Yer | Ne |
|---|---|
| `design/mobil-app-onizleme.html` | **TEK tasarım kaynağı** (telefon çerçeveli önizleme). Modül kayıt defteri `M`, görünümler, köprü uçları (`window.MOREN.*`). |
| `design/fonts/*.woff2` | Yerel yazı tipleri (Fraunces, Inter, JetBrains Mono · latin + latin-ext). `<style id="fontlar">` bunları kullanır; üretici app.html'e base64 gömer → ağ yokken de tasarım aynı. |
| `design/ek/<paket>.html` | Ek paket blokları (`<script>`/`<style>`): `MOREN_EK.modulEkle(id, tanım, çizici)` + `MOREN_EK.navEkle(grup, öğe)`. Üretici bunları `</body>` öncesine gömer. |
| `assets/app.html` | WebView'in gösterdiği ÜRETİLMİŞ dosya — elle düzenlenmez: `node scripts/build-app-html.cjs`. |
| `app/index.tsx` | RN köprüsü: giriş, canlı veri (`loadModule`), aksiyonlar (`handleAction`), kamera/OCR yükleme, bildirimler, WhatsApp, AI sohbet. Dayanıklılık: bağlantı şeridi (`MOREN.baglantiDurumu`), modül hatası → "Veri alınamadı" kartı, oturum düşünce sessiz yeniden giriş. |
| `lib/ek/<paket>.ts` | Ek paketlerin RN tarafı: modül yükleyicileri + aksiyonlar (`lib/ek/tur.ts` sözleşmesi; `lib/ek/index.ts` kayıt defteri). |
| `lib/api.ts`, `lib/auth.tsx` | Canlı API (Railway) + belirteç yenileme; müşavir `/auth/login`, mükellef `/portal/auth/login`. `api.ts` bağlantı/oturum-düştü dinleyicileri (`setBaglantiDinleyici`, `setOturumDustuDinleyici`). |
| `store/` | Mağaza metinleri, gizlilik politikası, yayın rehberi, veri güvenliği cevapları (`veri-guvenligi-cevaplari.md`), inceleme notu (`inceleme-notu.md`), ekran görüntüleri (`screenshots-2026-09/` + `uret.cjs`). |

## Geliştirme
```bash
cd apps/mobile
npm ci --legacy-peer-deps          # pnpm çalışma alanı DIŞINDA (kendi package-lock.json'ı)
node scripts/build-app-html.cjs    # design → assets/app.html (her tasarım değişikliğinde)
node scripts/onizleme-sunucu.cjs   # http://localhost:4620 → tarayıcıda 390×844 (canlı veri yok, tasarım/etkileşim denetimi)
npx tsc --noEmit                   # tip denetimi
npx expo start -c                  # telefonda Expo Go (belge tarayıcı Expo Go'da çalışmaz; EAS derlemesi gerekir)
```

## Yeni modül eklemek (ek paket düzeni, 2026-09-13)
1. `design/ek/<paket>.html`: `MOREN_EK.modulEkle('<id>', {t:'Başlık', sub:'…', kind:'<paket>'}, function(m,id){ var d=modLive(id); return dh(m)+…; });`
   ve `MOREN_EK.navEkle('Grup', ['ikon','Ad',C.gold,'m:<id>']);` — mevcut yardımcılar (`dh`, `rows`, `seg`, `pill*`, `tl`, `ic`, `morenAction`) kullanılır.
2. `lib/ek/<paket>.ts`: `yukleyiciler['<id>'] = async (ctx) => { const {data} = await ctx.api.get('/…'); ctx.pushModule('<id>', ctx.client, data); }`
   ve gerekiyorsa `aksiyonlar['<ad>'] = async (ctx, params) => ({ ok, msg })`.
3. `node scripts/build-app-html.cjs` → önizlemede bak → `npx tsc --noEmit`.
Kural: içerik UYDURMA — portaldaki gerçek uç ve alanlar (apps/api controller'ları) neyse o; veri yoksa "veri yok" yaz, örnek gösterme.

## Derleme / yayın
- Expo hesabı `moren123` (proje `@moren123/moren-mobil`). **Derleme: `node scripts/eas-derle.cjs android preview`** (APK) · `android production` (AAB) · `ios production` (Apple hesabı). Betik geçici kopya + node_modules kavşağı + küçük git deposu kurar (~3 MB yükleme); doğrudan `EAS_NO_VCS=1 eas build` 140 MB yükleyip ağda kopuyor (2026-09-13).
- iOS derlemesi Apple Developer hesabı ister (Muzaffer Bey'de). Ayrıntı: `store/YAYIN-REHBERI.md`.
- API adresi: `eas.json` → `EXPO_PUBLIC_API_URL=https://mali-musavir-app-production.up.railway.app/api/v1`.
