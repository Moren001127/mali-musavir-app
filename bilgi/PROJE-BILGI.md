# MOREN PORTAL — PROJE BİLGİ DOSYASI (ÖNCE BUNU OKU)

> Bu dosya projenin **canlı hafızasıdır**. Her oturumun **başında oku**, **sonunda güncelle**
> (aşağıdaki "Oturum Günlüğü"ne tarihli satır ekle). Sahibi: Muzaffer Ören (muzaffer@morenmusavirlik.com).
>
> **Son güncelleme:** 2026-06-02

---

## 0. EN KRİTİK KURALLAR (önce bunlar)

1. **Doğru sistem = SUNUCU.** Aktif çalışılan yer deploy edilmiş sürüm:
   - API → Railway: `mali-musavir-app-production.up.railway.app/api/v1`
   - Web → Vercel
   - Bu = `origin/main`. **Yerel kopya sadece yedektir** — yerel stack'i "çalışan ortam" diye ayağa kaldırmaya uğraşma.
2. **Üretim CANLI ve çoklu bilgisayar.** Agent + Chrome extension + portal birden çok PC'de canlı. **Onaysız production / agent-runtime değişikliği YAPMA.** Patch'i göster → riski açıkla → kullanıcı onaylayınca uygula/push et. Geri alınabilir tek commit tut.
3. **Docker artık kullanılmıyor.** `docker-compose.yml` terk edilmiş kalıntı.
4. **Yerelde AI maliyeti yok.** `apps/api/.env`'de OpenRouter/Anthropic anahtarı yok → yerel çalıştırma ücretli AI çağrısı tetiklemez (Moren AI / WhatsApp bot / OCR no-op olur).
5. **Kilitli modüller** (`KILITLI_MODULLER.md`): Mizan, KDV Kontrol, agent-runtime, E-Arşiv vb. — dokunma.
6. **Push = production deploy.** Sadece açık onayla.

---

## 1. ÜRÜN NEDİR

Moren Mali Müşavirlik ofisinin günlük operasyonunu tek akıllı portala toplayan **canlı** sistem. Üç katman:
1. **Operasyon portali** — mükellef/CRM, fatura muhasebeleştirme, KDV kontrol, mizan/bilanço/gelir tablosu, beyanname takip, cari kasa, e-arşiv, banka takip, fiş yazdırma.
2. **Otomasyon ajanları** — Luca, Mihsap, HGS, e-Beyanname/SGK toplayıcıları (dış sistemlere Playwright + Chrome extension + sunucu runner ile girer).
3. **Moren AI ekipleri** — Moren Ofis (içerik/cevap üreten AI) + Portal Geliştirme AI.

---

## 2. MİMARİ

Monorepo (pnpm workspaces + turbo):

| Konum | Ne | Deploy |
|---|---|---|
| `apps/api` | NestJS backend (~36 modül, 38 controller) | Railway (`railway.json`, `apps/api/Dockerfile`) |
| `apps/web` | Next.js 15 web (~46 sayfa, App Router) | Vercel (`vercel.json`) |
| `apps/mobile` | Expo / React Native (PWA + Capacitor hedefi) | EAS |
| `apps/luca-local-agent` | Playwright tabanlı yerel ajan (kullanıcı PC'si) | — |
| `apps/moren-auto-agent` | Chrome extension (manifest v3, Luca/Mihsap inject) | — |
| `packages/shared` | Ortak tipler, Zod şemaları, contract'lar | — |

- **Veri:** PostgreSQL + Prisma (~110 model, `apps/api/prisma/schema.prisma`, 30+ migration). Redis (Bull kuyruk). MinIO (S3 — evrak `S3_BUCKET=mali-musavir-docs`).
- **AI:** OpenRouter (Claude Sonnet/Haiku, Gemini Flash) — prod'da `OPENROUTER_API_KEY`.
- **Git:** `origin` → `github.com/Moren001127/mali-musavir-app`.

---

## 3. MODÜL HARİTASI (özet)

| Modül | API | Web |
|---|---|---|
| Mükellefler (CRM) | `/taxpayers` | `/panel/mukellefler` |
| Evraklar (S3) | `/documents` | `/panel/evraklar` *(UI kapalı)* |
| Beyannameler | `/beyanname-takip`, `/beyan-kayitlari` | `/panel/beyannameler` |
| KDV Kontrol 🔒 | `/kdv-control` | `/panel/kdv-kontrol` |
| Mizan + Finansal Tablo 🔒 | `/mizan`, `/bilanco`, `/gelir-tablosu` | `/panel/mizan` … |
| Cari Kasa | `/cari-kasa` | `/panel/cari-kasa` |
| E-Arşiv 🔒 | `/earsiv` | `/panel/e-arsiv` |
| Fatura Muhasebeleştirme | `/fatura-muhasebelestirme` | `/panel/fatura-isleme` |
| Moren AI | `/moren-ai` | `/panel/moren-ai` |
| Ajanlar (Luca/Mihsap/HGS) | `/agent/*`, `/luca`, `/mihsap` | `/panel/ajanlar/*` |
| Bordro & SGK | *(şema hazır)* | `/panel/bordro` *(UI kapalı)* |
| WhatsApp | `/whatsapp`, `/whatsapp-qr` | `/panel/whatsapp-qr` |

🔒 = kilitli modül (dokunma).

---

## 4. AJAN EKOSİSTEMİ (4 ayrı ajan)

- **Luca Local Agent** — `apps/luca-local-agent/src/agent.js`, Playwright, kullanıcı PC'sinde. `__morenNativeClickText` gibi native hover/click binding'leri burada (extension'da yok).
- **Mihsap Chrome Extension** — `apps/moren-auto-agent/`, portal proxy + inject.
- **Server/Railway Runner** — sunucuda toplayıcı (e-Beyanname, e-Tebligat, SGK hizmet/tahakkuk/işe-giriş-çıkış).
- **HGS Agent** — `hgs-agent/`, 2captcha entegrasyonu, Pazartesi 08:00 cron.
- **Production agent runtime:** `apps/api/public/agent-runtime.js` (~7800 satır, **untracked** — git'te değil). Extension'daki `agent.js` sadece LOADER; gerçek kodu backend'den `/api/v1/agent/runtime.js` ile taze çeker. Deploy = tüm PC'lerdeki extension yeni kodu otomatik çeker → Luca otomasyon hatalarında ÖNCE buraya bak.
- **Hedef siteler:** klasik Luca (`auygs.luca.com.tr`), Mihsap (`app.mihsap.com`). LUCASSO (yeni Luca v2.1) desteklenmiyor.

---

## 5. AÇIK İŞLER / BİLİNEN BOŞLUKLAR

Kaynak: kökteki `MOREN_PORTAL_OPERASYON_ANALIZ_2026-05-26.md` + `PLAN/` klasörü.

**Kritik (güvenlik/para):** SMMM tahsilat/abonman modülü yok · 2FA/TOTP yok · PII şifreleme sadece credential'larda · AI maliyet hard-cap yok · Sentry yok · 0 unit test.
**Yüksek (veri akışı):** Duyurular hâlâ localStorage · Bordro/Evraklar UI kapalı (backend hazır) · BeyanKaydi↔BeyanDurumu otomatik sync yok · proaktif bildirim ağı zayıf (sadece 2 modül bildirim üretiyor).

---

## 6. ÇALIŞMA AKIŞI (her oturum)

1. **Oku:** Bu dosyayı baştan oku, projeyi kav.
2. **Yap:** İşi yap — §0 güvenlik kurallarına uy, kilitli modüllere dokunma, production'a onaysız push etme.
3. **Güncelle & bitir:** Değişen bilgiyi ilgili bölüme işle + aşağıdaki "Oturum Günlüğü"ne tarihli satır ekle, sonra oturumu bitir.

---

## 7. OTURUM GÜNLÜĞÜ

- **2026-06-01** — `bilgi/` klasörü + `CLAUDE.md` oluşturuldu (önce-oku / sonra-güncelle akışı). Yerel↔sunucu senkron doğrulandı (`origin/main` birebir). ~3.7 GB temizlik: 7 eski deploy git-worktree'si (`git worktree remove`, branch'ler korundu), dev logları, kök `tmp/`, repoya yanlış girmiş `tmp-*` debug/mockup dosyaları (commit `fb039c9`, `7a9b67c`). "Docker terk, sunucu=doğru, yerel=yedek" netleşti.
- **2026-06-01 (2. oturum)** — Çalışan ajanı Max kalıcılığı tamam: Railway `CLAUDE_CODE_OAUTH_TOKEN`, 8 saatlik OAuth token yerine **uzun ömürlü** `claude setup-token` token'ıyla (`sk-ant-oat01-…`, ~1 yıl) değiştirildi (redeploy onaylı). **Canlı test geçti** — Railway env'iyle SDK `query` çağrısı Max'tan cevap verdi (API key kapalı), endpoint `/calisan/info`→401 sağlıklı. Kod değişmedi (token Railway env'de). Detay: `apps/api/calisan/son_durum.md`.
- **2026-06-01 (3. oturum)** — AI maliyet tavanı + kısmi Max geçişi (dal/PR, henüz canlıda DEĞİL). **Tespit:** WhatsApp botu + portal asistanı `morenAi.chat` üzerinden ücretli `ANTHROPIC_API_KEY` kullanıyor; Max (CLAUDE_CODE_OAUTH_TOKEN) sadece `calisan.run()` (araçsız test ucu) için. **Tavan:** yeni `common/ai-usage-logger.ts` helper'ları + env `AI_MONTHLY_COST_CAP_USD` (vars. $50; Max kaynakları hariç) → beyin/bot-eval/fiş-OCR/beyanname-PDF/fatura-OCR(KDV kilitli, minimal guard) tavan dolunca güvenli fallback + owner bildirimi; `/ai-cost/summary` artık tavan/harcanan/kalan döner. **Max geçişi:** yeni `common/max-inference.ts` (Agent SDK + OAuth, ücretsiz) → automation metin işleri, Moren Ofis Claude ajanları + DENİZ patrol + portal-dev, kişisel mesaj botu Max'a alındı (GPT/Gemini OpenRouter'da). Güvenlik valfi `AI_ALLOW_API_FALLBACK` (vars. kapalı). **API'de kalanlar (mecbur):** OCR/fiş/beyanname görsel, ses (OpenAI), Gemini hafıza, araç kullanan sohbet beyni. Yerelde çalıştırma testi YOK (Max token/canlı ortam yok); `tsc --noEmit` temiz.
- **2026-06-01 (4. oturum)** — Entegrasyonlar sayfasından (`apps/web/.../ayarlar/entegrasyonlar/page.tsx`) **Meta Cloud API alanları kaldırıldı** (Baileys QR'a geçildiği için): access token, phone ID, business ID, şablon adları, webhook token, test/kaydet/doğrula bölümleri. **Korunanlar:** master switch (aç/kapa) + Baileys QR kartı + Mesajlar + Bot Kalite + Otomasyon. Saf silme (3 ekleme / 195 silme); `tsc --noEmit` (web) temiz. Not: WhatsApp numarası henüz bağlı değil — kullanıcı portaldan QR okutacak; bağlanınca konuşmalar Mesajlar ekranına düşer.
- **2026-06-01 (6. oturum)** — **Mükellef Listesi + Mükellef Kartı yeniden tasarlandı** (yalnızca arayüz, backend/veri/mutation aynen). **Liste** (`apps/web/.../panel/mukellefler/page.tsx`): sakin ton (altın vurgu), 6 stat kartı + 5 filtre çipi tekrarı → **tek sıra tıklanabilir aşama kartına** birleştirildi (Tüm / Evrak bekleniyor / İşleniyor / Beyanname hazır / Verildi); her satıra `deriveStage` ile **durum etiketi** + 6 onay kutusu gruplanmış (Evrak·İşlem | İnd·Hes·Arşiv | Beyan) sade haliyle korundu; eski `filter` URL anahtarları geriye dönük destekleniyor (`islenmedi` eklendi). **Kart** (`.../mukellefler/[id]/page.tsx`): 20 portal/sorgu butonu ana ekrandan kaldırılıp **sağdan açılan panele** (`PortalDrawer`, başlıkta "Devlet Portalları" butonu) alındı; başlık kompaktlaştı (küçük avatar/logo + meta + yalnızca **aktif** kanal çipleri); sekmeler **gerçek sekme** (Bilgiler·Mükellefiyetler·SGK·E-Tebligat·Notlar) vs **ayrı sayfaya götüren linkler** (Beyannameler/Evraklar/Cari/KDV → "İlgili modüller" satırı) olarak ayrıldı; `MukellefiyetlerCard` aside'dan kendi sekmesine taşındı; **iki Kaydet barı tek başlık aksiyonuna** indirildi (alt sticky bar kaldırıldı). `tsc --noEmit` (web) **temiz**. İlk sürüm onayla canlıya alındı (commit `9440504`). **2. tur (kullanıcı geri bildirimi):** kart içi akordeon → **sol bölüm menüsü + içerik** (ayarlar paneli tarzı; 8 bölüm: Müşteri/Şirket·Yetkililer·İletişim·Şifreler·Bağ-Kur·Entegratör·Otomasyon·Sistem; dolu-bölüm göstergesi + altın odak halkaları); başlık butonu/panel **"Devlet Portalları" → "Kısayol Girişleri"**. `tsc` temiz, onayla canlıya alındı. **3. tur (2026-06-02):** liste durum etiketi 5 aşamaya çıkarıldı — Evrak bekleniyor → İşlem bekliyor → Kontrol bekliyor → Beyanname hazır → Verildi (her biri farklı renk; "İşlem" işaretli → kontrol-bekliyor, kontroller bitince → beyanname-hazır); KPI/filtre kartları 6'ya çıktı. Kart içi **düzleştirildi**: iç içe çerçeveler + gereksiz sağ başlık kaldırıldı, sol menü çerçevesiz/altın aktif çubuk + dikey ayraç, tür & defter **segment kontrolü**, alanlara altın odak halkası + koyu tarih/menü. `tsc` temiz, onayla canlıya alındı. Görsel doğrulama kullanıcının canlı portalında.
- **2026-06-01 (5. oturum)** — **WhatsApp = Kapso köprü, MOREN AI beyin** mimarisi devreye alındı (Baileys/QR terk; numara 0212 909 98 64 Kapso/Meta Cloud'da kayıtlı, uygulamaya kaydedilemiyordu). **Kapso paneli (tarayıcıdan) düzeltildi:** WhatsApp webhook'u (Meta-forward) ölü `api.morenmusavirlik.com`'dan **canlı Railway adresine** (`mali-musavir-app-production.up.railway.app/api/v1/whatsapp/webhook`) çevrilip **aktifleştirildi**. Sonuç: gelen mesajlar artık portal webhook'una düşüyor, **Mesajlar ekranında görünüyor** (owner test mesajı loglarda + ekranda doğrulandı; tenant fallback `moren`). Portal POST webhook'u imza doğrulamıyor → Kapso ham Meta payload'u direkt işleniyor. **Bot AI cevabı düzeltildi:** `moren-ai.service.ts` isteğinden `temperature` kaldırıldı (yeni modeller "temperature is deprecated for this model" 400 dönüyordu → bot "Şu an cevap üretemedim" yedeğine düşüyordu). **AÇIK İŞ:** giden gönderimde 404 "WhatsApp configuration not found" (Kapso send `phoneNumberId=1216497778203128` config'i) — izleniyor. Display name "Muzaffer Ören" Meta/WABA tarafında (Kapso panelinde yok).
- **2026-06-02 (e-Beyanname indirme — Hattat/liste-API yöntemi, CANLI + PROBE)** — Şikâyet: "beyannameleri çek"de PDF'lerin çoğu inmiyor, yanlış eşleşiyor (beyanname↔tahakkuk swap), 30dk+ sürüyor. **Kök sebep** (`portal-automation-railway-runner.service.ts` uçtan uca okundu): runner render-tabloyu kazıyıp OID'leri DOM onclick'inden (`extractEBeyannameOids`) çıkarmaya çalışıyordu ama ikon onclick'i `beyannameGoruntule(...)` ve içinde literal `beyannameOid=` YOK → güvenilir `/dispatch` IMAJ yolu kurulamıyor → satır-başına seri tıklama/popup-yakalama yedeğine düşüyor (kayıp + swap + timeout yığını). **Çözüm:** GİB'in kendi liste-API'si (`/dispatch?cmd=ARSIVBEYANNAMELISTESI`) BİRİNCİL yapıldı — yanıttaki `beyannameOid`+`tahakkukOid` ile zaten kanıtlı `buildEBeyannameDispatchUrl`+`savePdfFromRequestUrl` üzerinden 1.2sn aralıklı SIRALI indirme; belge tipi subcmd'den belli → **swap imkânsız**, tıklama/popup/OCR YOK → ~5dk hedefi. Eklenen: `collectApprovedEBeyannameViaListApi` + liste URL/çekme/JSON+HTML ayrıştırma + tek-seferlik `[EBPROBE]` doğrulama logu. `queryEBeyannameStatus` onaylandı dalına birincil+otomatik-yedek dallanması (liste-API null dönerse eski `collectApprovedEBeyannamePages` aynen çalışır). **Env bayrakları:** `PORTAL_AUTOMATION_EBEYANNAME_LIST_API` (vars.1), `_LIST_API_PROBE` (vars.1 — teyit sonrası 0 yap), `_LIST_API_TYPES` (CSV; boş=tüm türler tek sorgu), `_LIST_API_DURUM` (vars.0). Eski yol + tüm tıklama yardımcıları SİLİNMEDİ (kalıcı yedek; `_LIST_API=0` ile anında geri dön). `tsc --noEmit` temiz. **AÇIK:** liste-API yanıt biçimi (HTML/JSON), `beyannameTanim=""` tüm türleri veriyor mu, parametre adları CANLI doğrulanacak → ilk run sonrası Railway loglarındaki `[EBPROBE]`/`[EBSTAT]` satırlarına bakılacak; biçim doğruysa PROBE kapatılır.
- **2026-06-02 (e-Beyanname canlı log teşhisi — ASIL SEBEP env + tahakkuk URL + liste-API yakalama)** — İlk liste-API denemesi sonrası kullanıcı "hâlâ çoğu inmiyor" dedi. **Railway deploy loglarından (railway CLI ile) teşhis edildi.** **ASIL SEBEP:** Railway env `PORTAL_AUTOMATION_EBEYANNAME_MAX_APPROVED_ROWS=10` (eski test kalıntısı) → onaylı indirme **10 satırda** durup çıkıyordu (sayfada 25 vardı). **2000'e çıkarıldı** (env, redeploy). **Bulgu 2:** tahakkuk PDF'i GİB'den SADECE `ARSIV=T` (inline'sız) iniyor; `inline=true` 354 baytlık "Uyarı" HTML'i dönüyor → kod her tahakkukta 5 boş deneme harcıyordu. `buildEBeyannameDispatchUrl` tahakkuk artık `&ARSIV=T` (inline'sız) kuruyor; `ebeyannamePdfRequestUrlVariants` TAHAKKUKGORUNTULE için ARSIV=T-inline'sız varyantını ÖNCE deniyor. **Bulgu 3:** liste-API (`ARSIVBEYANNAMELISTESI`) yanıtı **XML zarf** (`<SERVICERESULT><TOKEN><SERVERERROR><HTMLCONTENT>`); skill'deki sabit parametreler GİB'ce reddediliyor ("VKN ve TC birlikte girmeyin"). Çözüm: GİB sayfasının kendi yaptığı **çalışan ARSIVBEYANNAMELISTESI isteğini context request listener ile YAKALA**, sayfalamayı (grupSayi) onun üzerinden yap (tahmin yok). Parser XML `<HTMLCONTENT>` + `<SERVERERROR>` log'u ekledi. Yeni log etiketleri: `[EBLIST]`, `[EBPROBE]`. `tsc --noEmit` temiz. **Doğrulama:** sonraki run'da `[EBLIST] yakalanan liste istegi method=...`, `[EBPROBE] serverError`, `[EBSTAT] liste-API ozet` satırlarına bakılacak; capture GET ise liste-API tüm satırları çekmeli. Capture POST çıkarsa bir tur daha gerekebilir.
- **2026-06-02 (Max geçişi — saf metin AI çağrıları, CANLI)** — 3. oturumdaki kısmi Max geçişi tamamlanıp canlıya alındı (kullanıcı onayı "push et"). **Max'a taşınanlar (hepsi `isMaxAvailable()` kontrollü, Max yoksa eski ücretli yola güvenle düşer):** (1) Dashboard brifingi `moren-ai.service.ts:getBrifing` — önce Max → API → deterministik; Max kaynağı `brifing-max` (tavandan hariç). (2) Fatura ucuz-karar katmanı `agent-events.callMihsapCheapModel` — Gemini/OpenAI'den ÖNCE Max (`mihsap-*-cheap-max`). (3) Bot kalite jürisi `bot-eval.judgeViaMax` (`whatsapp-bot-eval-max`). (4) Otomasyon ayrıştırıcı `automation-parser.parse` — `tool_choice` yerine JSON-prompt ile Max. (5) Ofis hafıza özeti `memory.service` + (6) personalar arda(Sonnet)/defne(Haiku) → Claude modeli (adapter Max'a yönlendirir). `ai-cost.service` SOURCE_LABELS yeni `-max`/`-cheap` kaynaklarını ilgili modüle gruplar. **API'de bırakıldı (bilinçli):** ana sohbet beyni + owner WhatsApp (araç kullanıyorlar; ortak Max kotası + gecikme riski). **ÖN KOŞUL:** memory/personalar yalnızca Railway'de `CLAUDE_CODE_OAUTH_TOKEN` varsa ücretsiz; yoksa Claude OpenRouter'a düşer (eski Gemini'den pahalı). `tsc --noEmit` temiz. **Not:** arka plan oto-commit değişiklikleri `8721f35` ("Mükellef..." mesajı) altında ilgisiz mukellefler sayfalarıyla birlikte commit+push etti — mesaj yanıltıcı ama içerik origin/main'de doğru.
- **2026-06-02 (Teknik & Sistem 8 modül — AI Maliyet imzalı görsel yenileme, CANLI)** — Kullanıcı "AI Maliyet sayfasının görselini" çok beğendi; sol menüdeki **Teknik & Sistem** grubundaki 8 sayfanın tamamı (maliyet baz alınarak) o imzaya çevrildi: üst renk şeridi + radial parıltılı `<header>` kartı + degrade ikon kutusu + renkli aksiyon butonu + degrade renkli özet/stat kartları. Her modül **ayrı renk teması** (aynı şekil, farklı kimlik): WhatsApp Otomasyonu `hatirlatmalar` zümrüt/teal · Tüm Ajanlar `ajanlar` indigo/mavi · Luca Oturumu `ajanlar/luca` teal+altın · Sağlık Panosu `ajan-saglik` yeşil+kırmızı · Yapılan İşlemler `ajanlar/loglar` çelik mavi (terminal `#0a0e1a` aynen) · Ayarlar `ayarlar` altın-kahve · Denetim Günlüğü `ayarlar/denetim` amber · Kilitli Modüller `sistem/kilitli-moduller` gül-kırmızı. **Sadece görsel** — useQuery/useMutation/handler/state/prop/tablo/iş mantığı dokunulmadı; kullanılmayan import temizlendi. İlk WhatsApp örneği onaylandıktan sonra kalan 7 modül paralel alt ajanlarla (her ajan tek dosya, çakışma yok) yapıldı; `tsc --noEmit` temiz. Onayla push edildi (commit `2d6c788`). Kök dizinde önizleme: `whatsapp-otomasyonu-onizleme.html`, `teknik-sistem-tasarim-galeri.html` (deploy dışı, sadece görsel onay için).
