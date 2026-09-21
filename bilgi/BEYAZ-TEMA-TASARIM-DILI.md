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
