# MOREN PORTAL — PROJE BİLGİ DOSYASI (ÖNCE BUNU OKU)

> Bu dosya projenin **canlı hafızasıdır**. Her oturumun **başında oku**, **sonunda güncelle**
> (aşağıdaki "Oturum Günlüğü"ne tarihli satır ekle). Sahibi: Muzaffer Ören (muzaffer@morenmusavirlik.com).
>
> **Son güncelleme:** 2026-06-01

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
