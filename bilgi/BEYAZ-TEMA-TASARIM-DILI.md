# Beyaz Tema Tasarım Dili (tema D) — Modül Yeniden Tasarım Rehberi

Tarih: 2026-09-21. Portal 19 Eylül'de beyaz kurumsal temaya (`html[data-theme='D']`, varsayılan) geçti. Gösterge paneli, sol menü, üst çubuk ve giriş sayfası bu belgedeki dile göre yenilendi ve Muzaffer Bey tarafından onaylandı. Diğer modüller de **aynı dile** çekilecek.

## 1. Hedef
"Profesyonel, sakin, beyaz kurumsal." Renk yalnız **anlam** taşır (durum, tür, aciliyet). Süs için renk yok.

**Kaldırılacak (koyu temadan kalan izler):**
- Bej/altın/pembe **gradyan bantlar** ve sayfa başlıklarındaki "MÜKELLEF CRM · OFİS OPERASYONLARI" gibi altın etiketler.
- **Serif (Fraunces) başlıklar**, altın (`#d4b876`) vurgular, `rgba(250,250,249,…)` beyazımsı metin tokenleri.
- Pastel **yıkama** zeminli kartlar, lila/mor çerçeve gradyanları, her satırı farklı renge boyanmış listeler.
- Cam/parıltı efektleri, koyu zemin varsayan `rgba(255,255,255,0.0x)` kutular (beyazda görünmez olur).
- Büyük kapsül düğmeler, aşırı dolgun renkli düğme grupları (FİRMA / ŞAHIS / BASİT / TÜMÜ gibi).

## 2. Paydalar (tokens)
Yazı tipi: **Inter** her yerde (`font-family: Inter, ui-sans-serif, system-ui, sans-serif`). Serif yok.

| Amaç | Değer |
|---|---|
| Sayfa zemini | `#f6f8fb` (mevcut) |
| Kart zemini | `#ffffff` |
| Kart kenarı | `#e3e8ef` · iç ayraç `#eef2f6` · zayıf ayraç `#edf1f5` |
| Kart yarıçapı | 14–16px (küçük parçalar 8–10px) |
| Kart gölgesi | `0 8px 24px rgba(15,23,42,.05)` (yalnız ana kartlar) |
| Ana metin (ink) | `#1e293b` · koyu vurgu `#0f172a` |
| İkincil metin | `#475569` · soluk `#64748b` · çok soluk `#94a3b8` · devre dışı `#cbd5e1` |
| Tablo başlığı | zemin `#f8fafc`/`#f1f5f9`, yazı `#475569`, 11px, 700, harf aralığı .06em, büyük harf |
| Tablo satırı | ayraç `#eef2f6`, zebra `#fbfcfd`, fare `#f4f7fb`, yükseklik 40–44px |

**Renk ailesi (Fatura İşleme Merkezi > Genel Bakış ile aynı):**

| Ad | Dolu (gradyan başlangıç→bitiş) | Yumuşak zemin | Yumuşak kenar | Yumuşak yazı |
|---|---|---|---|---|
| Çivit (ana vurgu) | `#4263eb → #5c7cfa` | `#edf2ff` | `#dbe4ff` | `#3b5bdb` |
| Mavi | `#1971c2 → #339af0` | `#e7f5ff` | `#c5e3fb` | `#1971c2` |
| Deniz yeşili | `#0ca678 → #20c997` | `#e6fcf5` | `#c3fae8` | `#099268` |
| Yeşil | `#2f9e44 → #51cf66` | `#ebfbee` | `#c6efd0` | `#2b8a3e` |
| Kehribar | `#f08c00 → #f9a825` | `#fff4e6` | `#ffd8a8` | `#d9480f` |
| Sarı-kehribar | `#f59f00` | `#fffbeb` | `#fde68a` | `#b45309` |
| Kırmızı | `#e03131 → #ff6b6b` | `#fff5f5` | `#ffc9c9` | `#c92a2a` |
| Mor | `#7048e8 → #9775fa` | `#f3f0ff` | `#e5dbff` | `#6741d9` |
| Gül | `#c2255c` | `#fff0f6` | `#fcc2d7` | `#c2255c` |
| Kurşuni (nötr) | `#5c6b7f → #8494a7` | `#f1f5f9` | `#e2e8f0` | `#475569` |

Anlam eşlemesi: **onaylanan/tamam yeşil · bekleyen/uyarı kehribar · hatalı/kritik kırmızı · devam eden/birincil çivit · bilgi mavi · nötr kurşuni**. Aciliyet kademesi (takvim): geçmiş gri · 0–1 gün kırmızı · 2–3 turuncu `#e8590c` · 4–5 kehribar · 6–7 deniz yeşili · 8+ yeşil.

## 3. Bileşen kalıpları
- **Sayfa başlığı:** sola yaslı; 36px yumuşak tonlu simge kutusu (ör. çivit `#edf2ff` zemin, `#4263eb` simge) + başlık 22px/700 `#1e293b` + alt satır 13px `#64748b` (kısa açıklama veya sayılar). Sağda eylemler. **Bant/gradyan/altın etiket YOK.**
- **Birincil düğme:** çivit gradyan zemin, beyaz yazı 13px/600, yarıçap 10px, gölge `0 8px 16px -10px #4263eb`. **İkincil:** beyaz zemin, `#dde3ea` kenar, `#475569` yazı. **Tehlikeli (Sil):** yumuşak kırmızı zemin `#fff5f5`, `#ffc9c9` kenar, `#c92a2a` yazı; fare ile dolu kırmızı.
- **Sekmeler / süzgeç grubu:** kapsül grup `#f1f5f9` zemin `#e2e8f0` kenar, etkin sekme beyaz zemin + çivit yazı + hafif gölge (Beyan tablosundaki "Verilme dönemi / Vergi dönemi" gibi). Sekme sayacı küçük kurşuni rozet.
- **Rozet/çip:** 999px, 11px/650, yumuşak zemin + aynı ailenin koyu yazısı + kenar (yukarıdaki tablo).
- **Sayaç kartları (KPI):** (a) Dolu gradyan kart + sağ üstte yarı saydam beyaz daire + beyaz yazı (gösterge paneli sayaçları) — sayfada en fazla 4–6 tane; **veya** (b) beyaz kart + gradyan simge kutusu + koyu sayı + ton çubuğu (gösterge paneli "Bu Ay İş Akışı" kutucukları). Aşama sayaçları için (b).
- **Tablolar:** tek ince çerçeve (`#e3e8ef`, 10–12px yarıçap), açık gri başlık, beyaz satırlar, hafif zebra; sayılar tabular-nums; sıfırlar soluk `#cbd5e1`.
- **Liste satırları (sohbet, bildirim, görev):** beyaz, alt ayraç `#eef2f6`, fare `#f8fafc`, seçili `#edf2ff` + sol 3px çivit çizgi; avatar/simge kutusu 36–40px yumuşak tonlu; birincil metin 13.5px/600 `#1e293b`, ikincil 12px `#64748b`, sağda zaman 11.5px `#94a3b8`.
- **Girdi alanları:** beyaz, `#dde3ea` kenar, 10px yarıçap, odakta çivit halka `0 0 0 3px #dbe4ff`. Yer tutucu `#94a3b8`.
- **Boş durum:** kesik çizgili `#dbe2ea` kutu, `#f8fafc` zemin, soluk simge + tek cümle.
- **Sohbet balonları (MOREN AI / WhatsApp):** karşı taraf beyaz balon `#e3e8ef` kenar; kendi mesajın çivit yumuşak `#edf2ff` (WhatsApp'ta yeşil yumuşak `#ebfbee` kullanılabilir); metin `#1e293b`; zaman damgası 11px `#94a3b8`; avatar 32px.

## 4. Uygulama yöntemi
1. Sayfayı **gerçek koddan** yeniden düzenle (mockup yok). İnline `portalStyle({...})` renkleri koyu tema tokenlerine gidiyor; beyaz temada doğru tonu vermek için **ya** inline değerleri bu belgedeki gerçek renklere çevir **ya da** öğeye `data-*` kancası koyup modülün kendi `<modul>-white.css` dosyasında `html[data-theme='D'] …` kurallarıyla (gerekirse `!important`) ez. Gösterge panelinde ikinci yol kullanıldı: `apps/web/src/components/dashboard/dashboard-white.css`, `calendar-white.css`; üst çubuk/menü: `apps/web/src/components/layout/owned-theme.css`. **Bu üç dosyaya dokunma.**
2. Koyu tema (A) çalışmaya devam etmeli: sadece `html[data-theme='D']` altında ez.
3. İşlev: mevcut veri akışları, uçlar, tıklamalar, kısayollar **korunur**. Yeniden tasarım = düzen + hiyerarşi + renk + okunabilirlik. Gereksiz/tekrarlayan öğeleri kaldırmak serbest, yeni iş mantığı uydurmak YASAK.
4. Yazı boyutları: başlık 22, kart başlığı 15/650, gövde 13–13.5, yardımcı 11.5–12, rozet 11, tablo başlığı 11 büyük harf. 10px altı yazı yok (rozet 10.5 hariç).

## 5. Doğrulama (zorunlu)
- `cd apps/web && npx tsc --noEmit -p tsconfig.json` temiz.
- Sahte çift zaten çalışıyor: web `http://localhost:3007`, sahte API `http://localhost:3006/api/v1`. Giriş: `/giris/musavir`, e-posta `muzaffer@morenmusavirlik.com`, şifre `sahte-deneme-1`.
- Eksik uç varsa `apps/web/scripts/mock/<modul>.cjs` dosyasına ekle (`uclar(yol, yontem, q, govde, jsonGonder, res)` imzası, eşleşmezse `false`; README orada). `mock-api.cjs`'e DOKUNMA; eklentiler her istekte otomatik yeniden yüklenir.
- Playwright ile ekran görüntüsü: `require(path.join(__dirname,'..','..','..','node_modules','.pnpm','playwright@1.60.0','node_modules','playwright'))`; viewport 1500×1000, `deviceScaleFactor: 2`, girişten sonra `document.fonts.ready` + 2–3 sn bekle. Örnek: `apps/web/scripts/kabuk-onizleme-goruntule.cjs`. Çıktılar `_previews/beyaz-modul/<modul>/` altına.
- Görüntüyü **kendin incele** (Read ile aç), bu belgeyle karşılaştır, kötü duran yeri düzelt, tekrar çek. En az: sayfa tam görünüm + kritik alt bölümler.

## 6. Sınırlar
- Kilitli modüllere dokunma (Mizan, KDV Kontrol, agent-runtime, e-Arşiv).
- Ortak dosyalara dokunma: `Sidebar.tsx`, `TopBar.tsx`, `owned-theme.css`, `dashboard-white.css`, `calendar-white.css`, `portal-theme.ts`, `mock-api.cjs`, `globals.css`, `package.json`.
- Commit/push YAPMA; `bilgi/PROJE-BILGI.md`'yi DEĞİŞTİRME (birleştirme ve günlük ana oturumda).
- Rapor: değişen dosyalar, ekran görüntüsü yolları, kaldırılan/öne çıkarılan öğeler, açık noktalar — kısa Türkçe.

## 7. İkinci tur (2026-09-21 akşam): kalan modüller — "genel yapıyı bozmadan" yeniden boyama
Muzaffer Bey'in isteği: "görselliği, sayaçları, düğmeleri, görünürlüğü **genel yapıyı çok bozmayacak şekilde** profesyonel olarak tasarla". Yani:
- **Düzen/yerleşim korunur** (sekmeler, sütunlar, tablolar, paneller aynı yerde). Değişen: renkler, yazı hiyerarşisi, başlık bandı, sayaç/çip/düğme/tablo/girdi görünümü, boşluklar. Sayfa başlığındaki bej/altın bant ve serif başlık → rehber sayfa başlığı kalıbı. Pastel/koyu kalıntı kutular → beyaz kart.
- **Sayaçlar:** rehber (b) tipi beyaz kart + gradyan simge kutusu + koyu sayı (ya da mevcut kutunun renkleri rehber tonlarına çekilir). **Düğmeler:** birincil çivit, ikincil beyaz, tehlikeli yumuşak kırmızı; Luca/GİB/Mihsap gibi "veri çek" düğmeleri ikincil ya da kendi tonunda yumuşak (Luca deniz yeşili, GİB çivit, SGK mavi) — dolu kapsül/altın YOK.
- **Yöntem tercihi:** modülün mevcut `*-white.css` / `beyaz.css` / `module-white.css` dosyası varsa onu genişlet; yoksa yeni `<modul>-white.css` ekle ve sayfadan içe aktar. TSX'e yalnız `data-*`/sınıf kancası ve başlık bloğu düzenlemesi; iş mantığına, uçlara, tıklamalara dokunma.
- **KİLİTLİ sayfalar** (`KILITLI_MODULLER.md`: `mizan/page.tsx`, `kdv-kontrol/page.tsx`, `e-arsiv/page.tsx`): `page.tsx` DOKUNULMAZ. Bu sayfalar zaten kendi CSS dosyasını içe aktarıyor (`mizan/beyaz.css`, `kdv-kontrol/kdv-white.css`, `e-arsiv/module-white.css`) → yalnız o CSS dosyasında, mevcut DOM/sınıf yapısına göre `html[data-theme='D']` kurallarıyla boya. Kanca eklemek için sayfayı değiştirme; seçicileri mevcut sınıf/öznitelik/yapıdan kur (`:has()`, `:nth-child`, `[class*='…']` serbest).
- **Ortak bileşenler** (`src/components/portal-automation/*`, `src/components/kdv/*`, `src/components/luca/*`, `MaliYorumKutusu.tsx`, `TaxpayerStatsCard.tsx`): yalnız görev tanımında sana verilenlere dokun; başkasına verilmiş olanı değiştirme.
- Görüntüler `_previews/beyaz-modul2/<modul>/`; betikler `apps/web/scripts/onizleme/`. Her modül için en az tam sayfa + bir ayrıntı görüntüsü; Read ile kendin incele.

## 8. İkinci turdan öğrenilenler (2026-09-21 gece, 31 modül CANLI)
- **Payda ezme en ucuz yol:** modül kökünde `--portal-*` değişkenlerini rehber ailesine yeniden tanımlayınca satır içi `portalStyle()` renkleri kendiliğinden beyaza oturur (altın→çivit, gül→kırmızı, copper→kehribar, plum→mor). Örnek: `butce/butce-white.css`, `aylik-odeme/beyaz.css`, `mali-tablolar-white.css` (Mizan · Bilanço · Gelir · İHÖ ortak katmanı, `mizan/beyaz.css` `@import` ile alır).
- **Ortak bant/altın şeridi aşmak için** seçici öneki `html[data-theme='D'] body [data-panel-main] …` (teknik grup) — `portal-white.css` / `operations-white.css` kurallarını özgüllükle geçer. `data-portal-page-header` özniteliği bej/altın bandı tetikler; rehber başlık kalıbına geçen sayfadan kaldırılır.
- **Soluk yazı hiyerarşisi:** `MUTED` alfa=1 olduğunda `ink`e düşer; `[style*="--portal-ink, #71717a)"]` gibi öznitelik seçicisiyle geri getirilir (Bütçe).
- **Duyuru afişi** `[data-duyuru-canvas]` içinde paydalar özgün lacivert/kâğıt değerine SABİT — afiş ve JPEG beyaz temadan etkilenmez.
- **`globals.css` `input[type=text]` dolgusu** Tailwind `pl-9`'u eziyor (simge yazının üstüne biner) — modül CSS'inde yalnız D temasında düzeltildi; koyu temada sürüyor.
- **Sahte çift paylaşımlı:** paralel ajanların yarım içe aktarımları Next dev'i geçici 500'e düşürür; önizleme betikleri 20 sn bekleyip yeniden dener (`tur2-*.cjs`). Yerleşik boş uçlar (`/luca/session-manager/status`, `/akilli-bildirim/settings`) eklentiden önce eşleştiğinden `page.route` ile `/…-sahte/` yoluna yönlendirilir.
- **Kilitli sayfalar** yalnız CSS ile boyandı ve hash'leri değişmedi (`git status` ile teyit). KDV Kontrol 7 sayaç kartı AYNI boyutta kaldı (Muzaffer Bey kuralı).

## 9. Üçüncü turdan öğrenilenler (2026-09-25, KDV Kontrol netleştirme)
- **Devre dışı rengi `#cbd5e1` OKUNMUYOR.** Beyaz zeminde 1.4:1 kontrast veriyor; düğme yazısı kayboluyor. Devre dışı öğede **`#78879b` yazı + kesikli (`dashed`) kenar + beyaz zemin** kullan (3.9:1). "Seçilemez" mesajını renk değil **biçim** taşısın. Tailwind'in `disabled:opacity-40` sınıfı da ezilmeli (`opacity: 1 !important`), yoksa süren işlem kartı hayalete döner.
- **lucide sınıf adlarını canlı DOM'dan doğrula.** lucide-react 0.395'te `Trash2` → **`lucide-trash2`** (tiresiz), `Download` → `lucide-download`. `svg.lucide-trash-2` yazan kural aylarca sessizce ölü kaldı. `:has(svg.lucide-*)` yazmadan önce `getComputedStyle` ile teyit et.
- **Geniş `span[style*='…-wash']` seçicisi komşu bölümü boyar.** `[data-kdv-band='teal'] + div span[style*='copper-wash']` kuralı, aynı ağaçta kalan komut şeridinin adım rakamlarını da kehribara çevirdi. Yama-CSS'te renk kurallarını **kapsayıcı ile daralt**; başka bir kuralı aşman gerekiyorsa `html[data-theme='D'] body …` önekini kullan.
- **Sayaç kartlarında rakam hizası.** Etiket 2–3 satıra kırılırsa rakamlar farklı yüksekliğe düşer ve şerit dağınık görünür. Etiket kabına **sabit yükseklik** ver, satır içi düğmeyi (⟳ yenile) karta `position:absolute` ile köşeye al.
- **Tam genişlik alt çubuk "ilerleme çubuğu" sanılıyor.** Sayaç kartının rengini taşıyan çizgi kısa (≈34px) ve rakamın hemen altında olsun; kartın dibine itilirse arada boşluk kalır.
- **Beyaz belge beyaz zeminde kaybolur.** Belge/fatura önizlemesinde kabın zemini `#e9eef5`, belgenin kendisine `1px #ccd6e2` kenar + gölge ver.
- **Yer tutucu ile gerçek değeri ayır.** Girdi değeri 14.5px/600 `#1e293b`; `::placeholder` `#c3cddb`/400. Aksi halde boş alan "0,00 yazıyor" diye okunuyor.
